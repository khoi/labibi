import { routineJobKey, runContinueJob, runJobKey } from "@labradoodle/adapter-kit";
import type { Actor, ProductEvent } from "@labradoodle/contracts";
import { AttachmentValidationError, expandSkillReferencesInPrompt } from "@labradoodle/core";
import type { Prisma } from "@labradoodle/db";
import {
  AnswerTooLongError,
  addChatMembers,
  ChatHasOtherPeopleError,
  createChat,
  deleteChat,
  leaveChat,
  listChatMembers,
  listChats,
  markChatRead,
  markChatUnread,
  NotWorkspaceMemberError,
  renameChat,
  setChatDoodle,
  setChatMuted,
} from "@labradoodle/db";
import { getLogger } from "@labradoodle/logging";
import { ORPCError } from "@orpc/server";
import { finishChatTeardown } from "../chat-teardown.js";
import type { RouterDeps } from "../router.js";
import { createRoutineTestRun, routineTestRunNonce, routineTestTarget } from "../routines.js";
import { withSerializableRetry } from "../serializable-retry.js";
import { assertTeachingSendAllowed } from "../taught-skills.js";
import { loadMessagePage } from "../thread-message-pages.js";
import type { ChatTarget } from "../thread-target.js";
import {
  reactToThreadMessage,
  resolveChatTarget,
  sendThreadMessage,
  stopThreadRuns,
  threadHead,
  threadSnapshot,
} from "../thread-target.js";
import { releaseComputerControl } from "./computer.js";
import type { RouterContext } from "./context.js";
import { mapBotSecretInputError } from "./doodle.js";
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

/** A chat reply hands the asker's own screen back to the run it steers. */
export function takeoverReleaser(deps: RouterDeps, actor: Actor) {
  return async (runId: string) => {
    await releaseComputerControl(deps, actor, "done", runId);
  };
}

function mapChatError(error: unknown): unknown {
  if (error instanceof NotWorkspaceMemberError) {
    return new ORPCError("BAD_REQUEST", { message: error.message });
  }
  if (error instanceof ChatHasOtherPeopleError) {
    return new ORPCError("FORBIDDEN", { message: error.message });
  }
  return error;
}

export function threadsRoutes(ctx: RouterContext) {
  const { deps, authed, codexCatalog, agentSkills } = ctx;
  /** Model setup is settled only once Doodle takes the turn; people-only chat needs none. */
  const doodleAdmission = (actor: Actor, target: ChatTarget) => {
    let setup: ReturnType<typeof modelSetup> | undefined;
    return {
      setup: () => (setup ??= modelSetup(deps, actor)),
      admit: async () => {
        setup ??= modelSetup(deps, actor);
        const resolved = await setup;
        if (resolved.needsModel && !(await botsRunOwnModels(deps, actor, [target.doodleId])))
          return false;
        await assertTeachingSendAllowed(deps.prisma, actor);
        return true;
      },
    };
  };
  const send = async (
    actor: Actor,
    input: Parameters<typeof sendThreadMessage>[3] & { threadId: string },
    startRoutines?: NonNullable<Parameters<typeof sendThreadMessage>[4]>["startRoutines"],
  ) => {
    const target = await resolveChatTarget(deps.prisma, actor, input);
    const admission = doodleAdmission(actor, target);
    const confirmingImages =
      input.imageHandling === "confirm" && Boolean(input.artifactIds?.length);
    const setup = confirmingImages ? await admission.setup() : null;
    const deployment = setup?.hasDeployment
      ? { provider: deps.env.defaultProvider, model: deps.env.defaultModel }
      : null;
    return sendThreadMessage(
      {
        ...deps,
        maxAttachmentsPerMessage: deps.env.maxAttachmentsPerMessage,
        imageAdmission: setup
          ? {
              secrets: deps.secrets,
              deployment,
              codexCatalog,
            }
          : undefined,
      },
      actor,
      target,
      input,
      {
        admitDoodle: admission.admit,
        releaseTakeover: takeoverReleaser(deps, actor),
        startRoutines,
      },
    ).catch((error: unknown) => {
      if (error instanceof AttachmentValidationError) {
        throw new ORPCError("BAD_REQUEST", { message: error.message });
      }
      throw error;
    });
  };
  return {
    threads: {
      list: authed.threads.list.handler(({ context }) => listChats(deps.prisma, context.actor)),
      create: authed.threads.create.handler(({ context, input }) =>
        createChat(deps.prisma, context.actor, input).catch((error) => {
          throw mapChatError(error);
        }),
      ),
      members: authed.threads.members.handler(({ context, input }) =>
        listChatMembers(deps.prisma, context.actor, input.threadId),
      ),
      addMembers: authed.threads.addMembers.handler(({ context, input }) =>
        addChatMembers(deps.prisma, context.actor, input).catch((error) => {
          throw mapChatError(error);
        }),
      ),
      setDoodle: authed.threads.setDoodle.handler(async ({ context, input }) => {
        const { chat, teardown } = await setChatDoodle(deps.prisma, context.actor, input);
        await finishChatTeardown(deps, context.actor, teardown, input.threadId);
        const routines = await deps.prisma.routine.findMany({
          where: { threadId: input.threadId },
          select: { id: true },
        });
        if (!input.doodle) {
          await Promise.all(
            routines.map((routine) =>
              deps.jobs.cancel(routineJobKey(routine.id)).catch(() => undefined),
            ),
          );
        }
        return chat;
      }),
      rename: authed.threads.rename.handler(({ context, input }) =>
        renameChat(deps.prisma, context.actor, input),
      ),
      leave: authed.threads.leave.handler(async ({ context, input }) => {
        const teardown = await leaveChat(deps.prisma, context.actor, input.threadId);
        await finishChatTeardown(deps, context.actor, teardown, input.threadId);
        return { ok: true as const };
      }),
      delete: authed.threads.delete.handler(async ({ context, input }) => {
        const teardown = await deleteChat(deps.prisma, context.actor, input.threadId).catch(
          (error) => {
            throw mapChatError(error);
          },
        );
        await finishChatTeardown(deps, context.actor, teardown, null);
        return { ok: true as const };
      }),
      setMuted: authed.threads.setMuted.handler(async ({ context, input }) => {
        await setChatMuted(deps.prisma, context.actor, input);
        return { ok: true as const };
      }),
      head: authed.threads.head.handler(async ({ context, input }) => {
        const target = await resolveChatTarget(deps.prisma, context.actor, input);
        return threadHead(deps.prisma, target);
      }),
      get: authed.threads.get.handler(async ({ context, input }) => {
        const target = await resolveChatTarget(deps.prisma, context.actor, input);
        return threadSnapshot(deps, target, context.actor);
      }),
      messages: authed.threads.messages.handler(async ({ context, input }) => {
        const target = await resolveChatTarget(deps.prisma, context.actor, input);
        return loadMessagePage(
          deps.prisma,
          target.threadId,
          input.before,
          THREAD_MESSAGE_PAGE_SIZE,
          input.around,
        );
      }),
      subscribe: authed.threads.subscribe.handler(async function* ({ context, input }) {
        const target = await resolveChatTarget(deps.prisma, context.actor, input);
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
                seq: 0,
                type: "heartbeat",
                createdAt: new Date().toISOString(),
                payload: {},
              };
              continue;
            }
            pending = undefined;
            if (next.done) return;
            await assertStillAuthorized();
            yield next.value;
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
            routineTestTarget(deps.prisma, actor, routineId),
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
        const target = await resolveChatTarget(deps.prisma, context.actor, input);
        const admission = doodleAdmission(context.actor, target);
        // Without a model or while teaching, the reaction is still saved; it just starts no turn.
        const result = await reactToThreadMessage(
          deps,
          context.actor,
          target,
          { ...input, admitDoodle: () => admission.admit().catch(() => false) },
          takeoverReleaser(deps, context.actor),
        );
        if (result.eventSeq != null) {
          await deps.events.notify(target.threadId, result.eventSeq).catch((error) => {
            getLogger().error("thread reaction realtime notification", error);
          });
        }
        const [runId] = result.runIds;
        return { ok: true as const, ...(runId ? { runId } : {}) };
      }),
      stop: authed.threads.stop.handler(async ({ context, input }) => {
        const target = await resolveChatTarget(deps.prisma, context.actor, input);
        await stopThreadRuns(deps, context.actor, target);
        return { ok: true as const };
      }),
      clear: authed.threads.clear.handler(async ({ context, input }) => {
        const target = await resolveChatTarget(deps.prisma, context.actor, input);
        const { cancelledRunIds, historyCompactionGeneration } = await deps.events
          .clearThread({
            spaceId: context.actor.spaceId,
            threadId: target.threadId,
            userId: context.actor.userId,
          })
          .catch((error) => {
            throw mapChatError(error);
          });
        const [configuredMemory] = await Promise.all([
          deps.memoryProviders.resolve(context.actor.spaceId).catch((error) => {
            getLogger().error("semantic memory resolution after thread clear failed", error);
            return null;
          }),
          Promise.all(
            cancelledRunIds.map((runId) =>
              deps.jobs.cancel(runJobKey(runId)).catch(() => undefined),
            ),
          ),
        ]);
        // Durable memories remain in their Space-private containers. Clear only removes
        // conversation-derived summaries from the previous generation; including the new
        // generation also covers a compaction job that began just after the clear committed.
        if (configuredMemory) {
          // Best effort: the conversation rows are already deleted, so failing the clear here
          // would help nothing — a failed purge only leaves stale summaries recallable.
          try {
            const purged = await configuredMemory.provider.purgeHistory(
              {
                threadId: target.threadId,
                generations: [
                  Math.max(0, historyCompactionGeneration - 1),
                  historyCompactionGeneration,
                ],
              },
              computerContext(context.actor, target.doodleId, `thread-clear:${target.threadId}`),
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
        const target = await resolveChatTarget(deps.prisma, context.actor, input);
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
        const { unreadAfterSeq } = await markChatRead(deps.prisma, context.actor, input.threadId);
        return { ok: true as const, unreadAfterSeq };
      }),
      markUnread: authed.threads.markUnread.handler(async ({ context, input }) => {
        await markChatUnread(deps.prisma, context.actor, input);
        return { ok: true as const };
      }),
    },
  };
}
