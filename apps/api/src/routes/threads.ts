import { runContinueJob, runJobKey } from "@labradoodle/adapter-kit";
import type { Actor, ProductEvent } from "@labradoodle/contracts";
import {
  AttachmentValidationError,
  expandSkillReferencesInPrompt,
  MODEL_REQUIRED_SEND_ERROR,
} from "@labradoodle/core";
import type { Prisma } from "@labradoodle/db";
import { AnswerTooLongError, IsolationError } from "@labradoodle/db";
import { getLogger } from "@labradoodle/logging";
import { ORPCError } from "@orpc/server";
import type { RouterDeps } from "../router.js";
import { createRoutineTestRun, routineTestRunNonce, routineTestTarget } from "../routines.js";
import { withSerializableRetry } from "../serializable-retry.js";
import { assertTeachingSendAllowed } from "../taught-skills.js";
import {
  isBackgroundRun,
  loadMessagePage,
  shouldForwardBackgroundThreadEvent,
} from "../thread-message-pages.js";
import type { ThreadTarget } from "../thread-target.js";
import {
  isStopMessage,
  markThreadRead,
  markThreadUnreadFrom,
  reactToThreadMessage,
  replyParentBotId,
  resolveThreadTarget,
  sendTargetBotIds,
  sendThreadMessage,
  setThreadUnreadState,
  stopThreadRuns,
  threadHead,
  threadSnapshot,
} from "../thread-target.js";
import { mapBotSecretInputError } from "./bots.js";
import { releaseComputerControl } from "./computer.js";
import type { RouterContext } from "./context.js";
import {
  botsRunOwnModels,
  computerContext,
  HEARTBEAT_MS,
  isUniqueViolation,
  modelSetup,
  SESSION_RECHECK_MS,
  THREAD_MESSAGE_PAGE_SIZE,
} from "./shared.js";

/** A send with routines that already has runs saved under its nonce. */
class SavedSubmission extends Error {}

/** A chat reply hands the screen back to the bot whose run it steers, in a group as in a DM. */
export function takeoverReleaser(deps: RouterDeps, actor: Actor, target: ThreadTarget) {
  return async (runId: string) => {
    const botId =
      target.kind === "bot"
        ? target.botId
        : (
            await deps.prisma.run.findUnique({
              where: { id: runId, spaceId: actor.spaceId },
              select: { botId: true },
            })
          )?.botId;
    if (botId) await releaseComputerControl(deps, actor, botId, "done", runId);
  };
}

export function threadsRoutes(ctx: RouterContext) {
  const { deps, authed, codexCatalog, repos, agentSkills } = ctx;
  /** The bot a reaction can wake: the thread's bot, or in a group the bot that wrote the message. */
  const reactedBotId = async (target: ThreadTarget, messageId: string) =>
    target.kind === "bot"
      ? target.botId
      : ((
          await deps.prisma.message.findFirst({
            where: { id: messageId, threadId: target.threadId },
            select: { botId: true },
          })
        )?.botId ?? target.memberBotIds[0]!);
  const send = async (
    actor: Actor,
    input: Parameters<typeof sendThreadMessage>[3] & { botId?: string; groupId?: string },
    startRoutines?: Parameters<typeof sendThreadMessage>[5],
  ) => {
    const setup = await modelSetup(deps, actor);
    const target = await resolveThreadTarget(deps.prisma, actor, input);
    // A bot with its own runnable model needs no main model, and stopping work needs none.
    const replied =
      target.kind === "group" ? await replyParentBotId(deps.prisma, target, input) : undefined;
    const noModel =
      setup.needsModel &&
      !(await botsRunOwnModels(deps, actor, sendTargetBotIds(target, input, replied)));
    if (noModel && (target.kind !== "bot" || !isStopMessage(input))) {
      throw new ORPCError("BAD_REQUEST", { message: MODEL_REQUIRED_SEND_ERROR });
    }
    if (target.kind === "bot") {
      await assertTeachingSendAllowed(deps.prisma, actor.spaceId, target.botId);
    }
    const confirmingImages =
      input.imageHandling === "confirm" && Boolean(input.artifactIds?.length);
    // Reuse the funding modelSetup resolved; a send never asks billing twice.
    const deployment = setup.hasDeployment
      ? { provider: deps.env.defaultProvider, model: deps.env.defaultModel }
      : null;
    return sendThreadMessage(
      {
        ...deps,
        maxAttachmentsPerMessage: deps.env.maxAttachmentsPerMessage,
        imageAdmission: confirmingImages
          ? {
              secrets: deps.secrets,
              deployment,
              hostedProvider: setup.creditsAvailable ? deployment?.provider : undefined,
              codexCatalog,
            }
          : undefined,
      },
      actor,
      target,
      { ...input, noModel },
      takeoverReleaser(deps, actor, target),
      startRoutines,
    ).catch((error: unknown) => {
      if (error instanceof AttachmentValidationError) {
        throw new ORPCError("BAD_REQUEST", { message: error.message });
      }
      throw error;
    });
  };
  return {
    threads: {
      head: authed.threads.head.handler(async ({ context, input }) => {
        const target = await resolveThreadTarget(deps.prisma, context.actor, input);
        return threadHead(deps.prisma, target);
      }),
      get: authed.threads.get.handler(async ({ context, input }) => {
        const target = await resolveThreadTarget(deps.prisma, context.actor, input, {
          includeArchived: true,
        });
        return threadSnapshot(deps, target, context.actor.userId);
      }),
      messages: authed.threads.messages.handler(async ({ context, input }) => {
        const target = await resolveThreadTarget(deps.prisma, context.actor, input, {
          includeArchived: true,
        });
        return loadMessagePage(
          deps.prisma,
          target.threadId,
          input.before,
          THREAD_MESSAGE_PAGE_SIZE,
          input.around,
        );
      }),
      subscribe: authed.threads.subscribe.handler(async function* ({ context, input }) {
        const target = await resolveThreadTarget(deps.prisma, context.actor, input);
        const backgroundRunCache = new Map<string, Promise<boolean>>();
        const follow = deps.events.follow(target.threadId, input.cursor, context.signal);
        // A half-open stream looks identical to an idle one, so punctuate silence:
        // the client treats any frame as liveness and reconnects once they stop.
        let pending: Promise<IteratorResult<ProductEvent>> | undefined;
        // Auth ran once when the stream opened. Re-check before delivering more, so a signed-out
        // or revoked session stops within SESSION_RECHECK_MS, or at the next heartbeat when idle.
        let authorizedAt = Date.now();
        const assertStillAuthorized = async () => {
          if (!context.stillAuthorized || Date.now() - authorizedAt < SESSION_RECHECK_MS) return;
          if (!(await context.stillAuthorized())) throw new ORPCError("UNAUTHORIZED");
          authorizedAt = Date.now();
        };
        try {
          while (!context.signal?.aborted) {
            pending ??= follow.next();
            let timer: ReturnType<typeof setTimeout> | undefined;
            const next = await Promise.race([
              pending,
              new Promise<"silent">((resolve) => {
                timer = setTimeout(() => resolve("silent"), HEARTBEAT_MS);
              }),
            ]).finally(() => clearTimeout(timer));
            if (next === "silent") {
              await assertStillAuthorized();
              // Keep `pending` so the in-flight read stays the next event in order.
              yield {
                id: "heartbeat",
                spaceId: context.actor.spaceId,
                threadId: target.threadId,
                // A bot thread's id is not the bot. Groups have no single bot, so the thread id stands in.
                botId: target.kind === "bot" ? target.botId : target.threadId,
                seq: 0,
                type: "heartbeat",
                createdAt: new Date().toISOString(),
                payload: {},
              };
              continue;
            }
            pending = undefined;
            if (next.done) return;
            const event = next.value;
            // Filtered events also restart the heartbeat, so check before skipping them.
            await assertStillAuthorized();
            if (
              (await isBackgroundRun(deps.prisma, event.runId, backgroundRunCache)) &&
              !shouldForwardBackgroundThreadEvent(event)
            )
              continue;
            yield event;
          }
        } finally {
          // Not awaited: closing can queue behind a read that the abort has not landed on yet.
          void follow.return(undefined).catch(() => {});
        }
      }),
      send: authed.threads.send.handler(({ context, input }) => send(context.actor, input)),
      sendWithRoutines: authed.threads.sendWithRoutines.handler(async ({ context, input }) => {
        const { actor } = context;
        // The same checks as routines/testRun, all before anything is written.
        const targets = await Promise.all(
          [...new Set(input.routineIds)].map((routineId) =>
            routineTestTarget(deps.prisma, repos, actor, routineId),
          ),
        );
        const skillRecords = await agentSkills.listWithContent(actor);
        const routines = targets.map((target) => ({
          target,
          prompt: expandSkillReferencesInPrompt(target.routine.prompt, skillRecords),
          nonce: routineTestRunNonce(
            actor,
            `routine-mention:${input.clientNonce}:${target.routine.id}`,
          ),
        }));
        const nonces = routines.map((routine) => routine.nonce);
        const savedRuns = (db: Pick<Prisma.TransactionClient, "run">) =>
          db.run.findMany({
            where: { spaceId: actor.spaceId, userId: actor.userId, clientNonce: { in: nonces } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { id: true },
          });
        const startRoutines = async (tx: Prisma.TransactionClient) => {
          // Any saved run means this submission was accepted; it is replayed, never extended. A
          // run another request commits after this lookup fails the insert below the same way.
          if ((await savedRuns(tx)).length) throw new SavedSubmission();
          const runs = [];
          for (const routine of routines) {
            runs.push(
              await createRoutineTestRun(tx, actor, routine.target, routine.prompt, routine.nonce),
            );
          }
          return runs;
        };
        let sent: Awaited<ReturnType<typeof send>> | undefined;
        try {
          if (input.text?.trim() || input.artifactIds?.length) {
            // A saved message for this nonce is replayed before any of this runs.
            sent = await send(actor, input, startRoutines);
          } else {
            // Only the routines: they all commit or none does.
            const started = await withSerializableRetry(() =>
              deps.prisma.$transaction(startRoutines),
            );
            for (const run of started) {
              await deps.jobs.enqueue(runContinueJob(run.id)).catch((error) => {
                getLogger().error("routine mention enqueue", error);
              });
            }
          }
        } catch (error) {
          // A concurrent retry that saved the same runs first wins on the unique key.
          const replay =
            error instanceof SavedSubmission ||
            (isUniqueViolation(error) && (await savedRuns(deps.prisma)).length > 0);
          if (!replay) throw error;
        }
        return {
          routineRunIds: (await savedRuns(deps.prisma)).map((run) => run.id),
          send: sent,
        };
      }),
      react: authed.threads.react.handler(async ({ context, input }) => {
        const target = await resolveThreadTarget(deps.prisma, context.actor, input);
        // Without a model or while teaching, the reaction is still saved; it just starts no turn.
        const mayStartTurn =
          (!(await modelSetup(deps, context.actor)).needsModel ||
            (await botsRunOwnModels(deps, context.actor, [
              await reactedBotId(target, input.messageId),
            ]))) &&
          (target.kind !== "bot" ||
            (await assertTeachingSendAllowed(deps.prisma, context.actor.spaceId, target.botId).then(
              () => true,
              () => false,
            )));
        const result = await reactToThreadMessage(
          deps,
          context.actor,
          target,
          { ...input, mayStartTurn },
          takeoverReleaser(deps, context.actor, target),
        );
        if (result.eventSeq != null) {
          await deps.events.notify(target.threadId, result.eventSeq).catch((error) => {
            getLogger().error("thread reaction realtime notification", error);
          });
        }
        return { ok: true as const, runIds: result.runIds };
      }),
      stop: authed.threads.stop.handler(async ({ context, input }) => {
        const target = await resolveThreadTarget(deps.prisma, context.actor, input);
        await stopThreadRuns(deps, context.actor, target);
        return { ok: true as const };
      }),
      clear: authed.threads.clear.handler(async ({ context, input }) => {
        const target = await resolveThreadTarget(deps.prisma, context.actor, input);
        const contextBotId = target.kind === "bot" ? target.botId : target.memberBotIds[0];
        if (!contextBotId) throw new IsolationError();
        const { cancelledRunIds, historyCompactionGeneration } = await deps.events.clearThread({
          spaceId: context.actor.spaceId,
          threadId: target.threadId,
          botId: contextBotId,
          ...(target.kind === "group" ? { groupId: target.groupId } : {}),
        });
        const [configuredMemory] = await Promise.all([
          target.kind === "bot"
            ? deps.memoryProviders.resolve(context.actor.spaceId).catch((error) => {
                getLogger().error("semantic memory resolution after thread clear failed", error);
                return null;
              })
            : Promise.resolve(null),
          Promise.all(
            cancelledRunIds.map((runId) =>
              deps.jobs.cancel(runJobKey(runId)).catch(() => undefined),
            ),
          ),
        ]);
        // Durable memories remain in their Space-private containers. Clear only removes
        // conversation-derived summaries from the previous generation; including the new
        // generation also covers a compaction job that began just after the clear committed.
        if (configuredMemory && target.kind === "bot") {
          // Best effort: the conversation rows are already deleted, so failing the clear here
          // would help nothing — a failed purge only leaves stale summaries recallable.
          try {
            const purged = await configuredMemory.provider.purgeHistory(
              {
                botId: target.botId,
                generations: [
                  Math.max(0, historyCompactionGeneration - 1),
                  historyCompactionGeneration,
                ],
              },
              computerContext(context.actor, target.botId, `thread-clear:${target.threadId}`),
            );
            if (!purged.ok) {
              getLogger().error("semantic memory purge after thread clear failed", purged.error);
            }
          } catch (error) {
            getLogger().error("semantic memory purge after thread clear failed", error);
          }
        }
        return { ok: true as const };
      }),
      answer: authed.threads.answer.handler(async ({ context, input }) => {
        const target = await resolveThreadTarget(deps.prisma, context.actor, input);
        const answered = await deps.events
          .answerRunInput({
            spaceId: context.actor.spaceId,
            threadId: target.threadId,
            runId: input.runId,
            messageId: input.messageId,
            answeredByUserId: context.actor.userId,
            answer: input.answer,
            fields: input.fields,
            username: input.username,
            remember: input.remember,
            dismiss: input.dismiss,
          })
          .catch((error: unknown) => {
            if (error instanceof AnswerTooLongError)
              throw new ORPCError("BAD_REQUEST", { message: error.message });
            // A typed credential its destination cannot carry (e.g. a header with a line break).
            throw mapBotSecretInputError(error);
          });
        if (!answered) {
          throw new ORPCError("CONFLICT", {
            message: "This prompt is no longer awaiting an answer",
          });
        }
        await deps.jobs.enqueue(runContinueJob(input.runId)).catch((error) => {
          // The answer and queued run are durable; the reconciler repairs a missed immediate wake.
          getLogger().error("thread answer enqueue", error);
        });
        return { ok: true as const };
      }),
      markRead: authed.threads.markRead.handler(async ({ context, input }) => {
        const target = await resolveThreadTarget(deps.prisma, context.actor, input);
        const unreadAfterSeq = await markThreadRead(deps.prisma, context.actor, target);
        return { ok: true as const, unreadAfterSeq };
      }),
      markUnread: authed.threads.markUnread.handler(async ({ context, input }) => {
        const target = await resolveThreadTarget(deps.prisma, context.actor, input);
        if (input.messageId) {
          await markThreadUnreadFrom(deps.prisma, context.actor, target, input.messageId);
        } else {
          await setThreadUnreadState(deps.prisma, context.actor, target, true);
        }
        return { ok: true as const };
      }),
    },
  };
}
