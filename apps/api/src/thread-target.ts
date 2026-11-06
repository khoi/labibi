import type { JobPublisher, ProductAnalytics, SandboxProvider } from "@labradoodle/adapter-kit";
import { runContinueJob } from "@labradoodle/adapter-kit";
import {
  cancelComputerRunWork,
  completionNotificationPreview,
  findPersonComputer,
  newComputerKind,
  notifyChat,
  screenLeaseIdForRun,
  toComputerRef,
} from "@labradoodle/adapters";
import type {
  Actor,
  ChatMentionTarget,
  MessageBlock,
  MessageReaction,
  ReplyPreview,
  ThreadSnapshot,
} from "@labradoodle/contracts";
import { MessageBlock as MessageBlockSchema } from "@labradoodle/contracts";
import type { ChatAuthor } from "@labradoodle/core";
import {
  ACTIVE_RUN_STATUSES,
  BACKGROUND_RUN_TRIGGERS,
  doodleReplies,
  isConversationalRun,
  MODEL_REQUIRED_SEND_ERROR,
  messageBypassesTakeoverWait,
  messageReaction,
  projectMessages,
  QUEUE_HOLDING_RUN_STATUSES,
  runFailureError,
  runReadsThreadHistory,
} from "@labradoodle/core";
import { deriveMessageQuote, messageReplyPreview } from "@labradoodle/core/message-quote";
import type { Prisma, PrismaClient, ThreadEvents } from "@labradoodle/db";
import {
  answerWaitingRunWithTextInTransaction,
  appendEventInTransaction,
  clearEndedRunState,
  createThreadMessageInTransaction,
  eligibleWaitingTextAnswer,
  expireComputerExecutionLeases,
  getChat,
  IsolationError,
  loadMessageAuthor,
  requireChatMember,
  retireWaitingQuestionInTransaction,
  THREAD_LOCK_TRANSACTION_OPTIONS,
  transientRunEventsWhere,
} from "@labradoodle/db";
import { getLogger } from "@labradoodle/logging";
import { ORPCError } from "@orpc/server";
import { buildSendPrompt, buildUserMessageBlocks, resolveSendAttachments } from "./artifacts.js";
import { toComputerStatus } from "./computer-status.js";
import type { ImageAdmissionRun } from "./thread-image-admission.js";
import { assertThreadImageInput } from "./thread-image-admission.js";
import { loadMessagePage } from "./thread-message-pages.js";

/** A chat the caller is in, with what decides whether Doodle answers there. */
export type ChatTarget = {
  threadId: string;
  spaceId: string;
  /** The workspace's Doodle. */
  doodleId: string;
  /** Doodle is on in this chat. */
  doodle: boolean;
  /** People in the chat, the caller included. */
  people: number;
};

const THREAD_MESSAGE_PAGE_SIZE = 100;
const RUNS_NEEDING_CONTINUE = new Set(["queued", "waiting_takeover"]);

const STEERABLE_RUN_STATUSES = new Set<string>(QUEUE_HOLDING_RUN_STATUSES);
/**
 * An answer steers the waiting run it resumes when the model must see its image, or when the run
 * reads no thread history and would otherwise never get the attachment.
 */
function answerSteersRun(
  run: { trigger?: string | null },
  attachments: MessageBlock[],
  imageHandling: "confirm" | "file" | undefined,
) {
  return (
    (imageHandling === "confirm" && attachments.some((block) => block.kind === "image")) ||
    (attachments.length > 0 && !runReadsThreadHistory(run.trigger))
  );
}

/** Background work holds pending steering; paused cards never hold the queue. */
function steersUserMessage(run: { status: string; trigger?: string | null }) {
  return STEERABLE_RUN_STATUSES.has(run.status) && isConversationalRun(run.trigger);
}

/** A run acts with its sender's accounts, so only that person's messages may steer it. */
function steersMessageFrom(
  run: { status: string; trigger?: string | null; userId: string },
  actor: Actor,
) {
  return steersUserMessage(run) && run.userId === actor.userId;
}

/** Mention chips from the composer. Only Doodle, connectors and routines change a send. */
type MentionTargetInput = ChatMentionTarget;

function splitMentionTargets(mentions: readonly MentionTargetInput[] | undefined) {
  const connectorMentionIds = new Set<string>();
  for (const mention of mentions ?? []) {
    if (mention.kind === "connector") connectorMentionIds.add(mention.id);
  }
  return { connectorMentionIds: [...connectorMentionIds] };
}

function sendRunClientNonce(clientNonce: string | undefined, messageId: string) {
  return clientNonce ? `send:${messageId}` : undefined;
}

/** The chat when the caller is in it; anyone else gets not-found, the workspace owner included. */
export async function resolveChatTarget(
  prisma: PrismaClient,
  actor: Actor,
  input: { threadId: string },
): Promise<ChatTarget> {
  const thread = await requireChatMember(prisma, actor, input.threadId);
  const [people, doodle] = await Promise.all([
    prisma.threadMember.count({ where: { threadId: thread.id } }),
    prisma.bot.findUnique({ where: { spaceId: actor.spaceId }, select: { id: true } }),
  ]);
  if (!doodle) throw new IsolationError();
  return {
    threadId: thread.id,
    spaceId: thread.spaceId,
    doodleId: doodle.id,
    doodle: thread.doodle,
    people,
  };
}

/** Who wrote a message, as the reply policy reads it. */
function messageAuthor(message: {
  role: string;
  authorUserId: string | null;
}): ChatAuthor | undefined {
  if (message.role === "bot") return { kind: "doodle" };
  if (message.role === "user" && message.authorUserId)
    return { kind: "person", userId: message.authorUserId };
  return undefined;
}

/**
 * Whether Doodle takes this message: its reply policy, or a run of the sender's own it steers
 * or a question of theirs it answers.
 */
async function doodleTakesMessage(
  db: Pick<Prisma.TransactionClient, "message" | "run">,
  actor: Actor,
  target: ChatTarget,
  input: { mentions?: readonly MentionTargetInput[]; replyToMessageId?: string },
) {
  if (!target.doodle) return false;
  const [reply, ownRuns, waiting] = await Promise.all([
    input.replyToMessageId
      ? db.message.findFirst({
          where: { id: input.replyToMessageId, threadId: target.threadId },
          select: { role: true, authorUserId: true },
        })
      : null,
    db.run.findMany({
      where: {
        threadId: target.threadId,
        userId: actor.userId,
        status: { in: [...QUEUE_HOLDING_RUN_STATUSES] },
      },
      select: { status: true, trigger: true, userId: true },
    }),
    db.run.findMany({
      where: { threadId: target.threadId, status: "waiting_input" },
      select: { id: true, status: true, updatedAt: true, userId: true },
    }),
  ]);
  if (ownRuns.some((run) => steersMessageFrom(run, actor))) return true;
  return doodleReplies({
    kind: "message",
    doodle: target.doodle,
    people: target.people,
    senderUserId: actor.userId,
    mentions: input.mentions ?? [],
    replyTo: reply ? messageAuthor(reply) : undefined,
    openQuestionFor: latestWaitingRun(waiting)?.userId,
  });
}

/** Tells the chat's other people about a message someone wrote. */
async function notifyPeopleOfMessage(
  deps: Parameters<typeof notifyChat>[0],
  actor: Actor,
  target: ChatTarget,
  blocks: MessageBlock[],
) {
  const sender = await deps.prisma.user.findUnique({
    where: { id: actor.userId },
    select: { name: true },
  });
  const text = blocks
    .map((block) =>
      block.kind === "text"
        ? block.text
        : block.kind === "file" || block.kind === "image"
          ? block.name
          : "",
    )
    .filter(Boolean)
    .join(" ");
  await notifyChat(deps, {
    spaceId: target.spaceId,
    threadId: target.threadId,
    except: actor.userId,
    message: {
      kind: "message",
      title: sender?.name.trim() || "New message",
      body: completionNotificationPreview(text),
      threadId: target.threadId,
      sender: { name: sender?.name.trim() || "" },
    },
  });
}

export async function threadHead(prisma: PrismaClient, target: ChatTarget) {
  const latest = await prisma.event.findFirst({
    where: { threadId: target.threadId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  return { threadId: target.threadId, cursor: latest?.seq ?? -1 };
}

export async function threadSnapshot(
  deps: { prisma: PrismaClient },
  target: ChatTarget,
  actor: Actor,
): Promise<ThreadSnapshot> {
  // Lock the thread row so messages, the event cursor, active runs, and live
  // progress are read from one consistent commit. A torn Promise.all can
  // otherwise advance the client cursor past thread.message.created while the
  // ask message page still omits it — leaving waiting_input with no AskCard.
  const [chat, computer, core] = await Promise.all([
    getChat(deps.prisma, actor, target.threadId),
    findPersonComputer(deps.prisma, actor),
    deps.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM threads WHERE id = ${target.threadId} FOR SHARE`;
        const [messagePage, last, activeRuns, busyOrFailed] = await Promise.all([
          loadMessagePage(tx, target.threadId, undefined, THREAD_MESSAGE_PAGE_SIZE),
          tx.event.findFirst({
            where: { threadId: target.threadId },
            orderBy: { seq: "desc" },
            select: { seq: true },
          }),
          tx.run.findMany({
            where: {
              threadId: target.threadId,
              status: { in: [...ACTIVE_RUN_STATUSES] },
              OR: [
                { trigger: { notIn: [...BACKGROUND_RUN_TRIGGERS] } },
                { status: { in: ["waiting_input", "waiting_takeover"] } },
              ],
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          }),
          tx.run.findFirst({
            where: {
              threadId: target.threadId,
              // Background work stays silent; waiting is handled above.
              trigger: { notIn: [...BACKGROUND_RUN_TRIGGERS] },
              status: { in: [...ACTIVE_RUN_STATUSES, "failed"] },
            },
            // The id tiebreak keeps ordering deterministic under equal timestamps.
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          }),
        ]);
        const run = pickPrimaryPrivateActiveRun(activeRuns) ?? busyOrFailed;
        // A failure only surfaces while it is still the newest terminal run, or a stale
        // failure would reappear on every load. Compare by ordering, not timestamps:
        // equal createdAt values reverse under gt/gte.
        const newestTerminal =
          run?.status === "failed"
            ? await tx.run.findFirst({
                where: {
                  threadId: target.threadId,
                  // Background failures must not bury a user-visible failure.
                  trigger: { notIn: [...BACKGROUND_RUN_TRIGGERS] },
                  status: { in: ["failed", "completed", "cancelled"] },
                },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                select: { id: true },
              })
            : null;
        const currentRun = run?.status === "failed" && newestTerminal?.id !== run.id ? null : run;
        const liveEvents =
          activeRuns.length > 0
            ? await tx.event.findMany({
                where: {
                  threadId: target.threadId,
                  runId: { in: activeRuns.map((run) => run.id) },
                  type: {
                    in: [
                      "thread.progress",
                      "thread.subagent",
                      "run.waiting_input",
                      "computer.takeover.requested",
                      "agent.tool.called",
                      "agent.tool.completed",
                    ],
                  },
                },
                orderBy: { seq: "asc" },
              })
            : [];
        return { messagePage, last, run: currentRun, activeRuns, liveEvents };
      },
      { timeout: 15_000, maxWait: 5_000 },
    ),
  ]);
  return {
    threadId: target.threadId,
    cursor: core.last?.seq ?? -1,
    messages: messagesWithLiveEvents(core.messagePage.messages, core.liveEvents, core.activeRuns),
    olderCursor: core.messagePage.olderCursor,
    chat,
    run: core.run ? mapRun(core.run) : null,
    activeRuns: core.activeRuns.map(mapRun),
    // The viewer's own computer: nobody sees another person's.
    computer: toComputerStatus(computer, computer ? undefined : await newComputerKind(deps.prisma)),
  };
}

async function resolveOwnedConnectorDisplayNames(
  tx: Prisma.TransactionClient,
  actor: Actor,
  connectionIds: string[],
) {
  if (!connectionIds.length) return [];
  const rows = await tx.connection.findMany({
    where: {
      id: { in: connectionIds },
      spaceId: actor.spaceId,
      userId: actor.userId,
      status: "connected",
    },
    select: { id: true, displayName: true },
  });
  if (rows.length !== connectionIds.length) throw new IsolationError();
  const byId = new Map(rows.map((row) => [row.id, row.displayName]));
  return connectionIds.map((id) => byId.get(id) ?? "connector");
}

async function enqueueRunsNeedingContinue(
  jobs: JobPublisher,
  runs: Array<{ id: string; status: string }>,
) {
  await Promise.all(
    runs
      .filter((run) => RUNS_NEEDING_CONTINUE.has(run.status))
      .map((run) =>
        jobs.enqueue(runContinueJob(run.id)).catch((error) => {
          // The queued run is durable; the reconciler repairs a missed immediate wake.
          getLogger().error("thread send enqueue", error);
        }),
      ),
  );
}

async function findSendReceipt(prisma: PrismaClient, threadId: string, clientNonce: string) {
  return prisma.message.findUnique({
    where: { threadId_clientNonce: { threadId, clientNonce } },
    include: { sourceRuns: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
}

async function replayExistingSend(
  deps: { prisma: PrismaClient; events: ThreadEvents; jobs: JobPublisher },
  threadId: string,
  clientNonce: string | undefined,
  releaseTakeover?: (runId: string) => Promise<void>,
) {
  if (!clientNonce) return null;
  const message = await findSendReceipt(deps.prisma, threadId, clientNonce);
  if (!message) return null;
  const receiptEvent = await deps.prisma.event.findFirst({
    where: {
      threadId,
      type: "thread.message.created",
      payload: { path: ["messageId"], equals: message.id },
    },
    orderBy: { seq: "desc" },
    select: { payload: true },
  });
  const receiptRunIds = sendEventRunIds(receiptEvent?.payload);
  const receiptRuns = receiptRunIds.length
    ? await deps.prisma.run.findMany({ where: { id: { in: receiptRunIds } } })
    : [];
  const receiptRunById = new Map(receiptRuns.map((run) => [run.id, run]));
  const orderedReceiptRuns = receiptRunIds.flatMap((id) => {
    const run = receiptRunById.get(id);
    return run ? [run] : [];
  });
  const linkedRun =
    message.sourceRuns[0] ??
    (message.runId ? await deps.prisma.run.findUnique({ where: { id: message.runId } }) : null);
  if (!linkedRun && orderedReceiptRuns.length === 0) return null;
  const runs = orderedReceiptRuns.length
    ? orderedReceiptRuns
    : message.sourceRuns.length
      ? message.sourceRuns
      : [linkedRun!];
  const pendingSteering = releaseTakeover
    ? await deps.prisma.steeringMessage.findFirst({
        where: { messageId: message.id, claimedAt: null },
        select: { runId: true },
      })
    : null;
  if (releaseTakeover && pendingSteering?.runId) await releaseTakeover(pendingSteering.runId);
  await enqueueRunsNeedingContinue(deps.jobs, runs);
  const latestEvent = await deps.prisma.event.findFirst({
    where: { threadId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  if (latestEvent) {
    await deps.events.notify(threadId, latestEvent.seq).catch((error) => {
      // Subscribers catch up from the durable event cursor after a missed realtime wake.
      getLogger().error("thread send realtime notification", error);
    });
  }
  return sendResult(message, runs);
}

function sendEventRunIds(payload: Prisma.JsonValue | undefined): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const runIds = (payload as { runIds?: unknown }).runIds;
  return Array.isArray(runIds) ? runIds.filter((id): id is string => typeof id === "string") : [];
}

function sendResult(message: { seq: number }, runs: Array<{ id: string; taskId: string }>) {
  const first = runs[0];
  if (!first) throw new IsolationError("Send did not create a run");
  return {
    taskId: first.taskId,
    runId: first.id,
    seq: message.seq,
    runIds: runs.map((run) => run.id),
  };
}

export async function cancelSupersededQueuedRuns(
  tx: Prisma.TransactionClient,
  input: { threadId: string; keepRunIds: string[] },
) {
  const superseded = await tx.run.findMany({
    where: {
      threadId: input.threadId,
      status: "queued",
      OR: [{ trigger: "user", sourceMessage: { role: "user" } }, { trigger: "reaction" }],
      id: { notIn: input.keepRunIds },
    },
    select: { id: true, taskId: true },
  });
  if (superseded.length === 0) return;
  const now = new Date();
  await tx.run.updateMany({
    where: { id: { in: superseded.map((run) => run.id) } },
    data: { status: "cancelled", completedAt: now },
  });
  await clearEndedRunState(
    tx,
    superseded.map((run) => run.id),
  );
  await tx.task.updateMany({
    where: { id: { in: superseded.map((run) => run.taskId) } },
    data: { status: "cancelled" },
  });
}

export function latestWaitingRun<T extends { id: string; status: string; updatedAt: Date }>(
  runs: T[],
) {
  const later = (a: T, b: T) =>
    a.updatedAt.getTime() - b.updatedAt.getTime() || a.id.localeCompare(b.id);
  return runs
    .filter((run) => run.status === "waiting_input")
    .reduce<T | undefined>(
      (latest, run) => (!latest || later(run, latest) > 0 ? run : latest),
      undefined,
    );
}

/** Private threads prioritize takeover, then live work, while pending cards stay active. */
function pickPrimaryPrivateActiveRun<T extends { status: string }>(
  runs: readonly T[],
): T | undefined {
  return (
    runs.find((run) => run.status === "waiting_takeover") ??
    runs.find((run) => run.status === "running") ??
    runs.find((run) => run.status === "leased") ??
    runs[0]
  );
}

function messagesWithLiveEvents(
  persisted: ThreadSnapshot["messages"],
  liveEvents: Parameters<typeof projectMessages>[0],
  runs: NonNullable<Parameters<typeof projectMessages>[1]>,
) {
  const live = projectMessages(liveEvents, runs).filter((message) => {
    if (message.blocks.some((block) => block.kind === "progress" || block.kind === "steps")) {
      return true;
    }
    if (!message.id.startsWith("subagent:")) return false;
    return !persisted.some((row) =>
      row.blocks.some(
        (block) => block.kind === "subagent" && message.id === `subagent:${block.agentId}`,
      ),
    );
  });
  return [...persisted, ...live];
}

function mapRun(run: {
  id: string;
  userId: string;
  botId: string;
  threadId: string;
  taskId: string;
  status: string;
  trigger: string;
  routineId: string | null;
  modelProvider: string | null;
  modelId: string | null;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: run.id,
    userId: run.userId,
    botId: run.botId,
    threadId: run.threadId,
    taskId: run.taskId,
    status: run.status as never,
    trigger: run.trigger as never,
    routineId: run.routineId ?? null,
    modelProvider: run.modelProvider,
    modelId: run.modelId,
    // Same display clamp as live run.failed events so a huge stored error cannot bypass it.
    error:
      run.status === "failed"
        ? runFailureError({ type: "run.failed", payload: { error: run.error } })
        : run.error,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
  };
}

/**
 * Admit a confirmed image against the model each recipient run will use: the waiting runs this
 * text answers, otherwise the run that would take it as steering, otherwise Doodle's default.
 */
async function assertImageRecipients(
  tx: Prisma.TransactionClient,
  actor: Actor,
  target: { threadId: string },
  text: string | undefined,
  attachmentBlocks: MessageBlock[],
  recipient: {
    botId: string;
    runs: Array<ImageAdmissionRun & { id: string; userId: string }>;
    imageAdmission: Parameters<typeof assertThreadImageInput>[5];
  },
) {
  if (!attachmentBlocks.some((block) => block.kind === "image")) return;
  const { botId, runs } = recipient;
  const answered = [];
  for (const run of runs.filter(
    (run) => run.status === "waiting_input" && run.userId === actor.userId,
  )) {
    const eligible = await eligibleWaitingTextAnswer(tx, {
      spaceId: actor.spaceId,
      threadId: target.threadId,
      runId: run.id,
      answeredByUserId: actor.userId,
      answer: text ?? "",
    });
    if (eligible) answered.push(run);
  }
  // Another person's run never takes this message: it starts or steers the sender's own run,
  // so only their runs can decide which model the image must suit.
  const own = runs.filter((run) => run.userId === actor.userId);
  const current =
    own.find(steersUserMessage) ?? own.find((run) => STEERABLE_RUN_STATUSES.has(run.status));
  for (const run of answered.length ? answered : [current]) {
    await assertThreadImageInput(
      tx as unknown as PrismaClient,
      actor,
      botId,
      attachmentBlocks,
      run && (isConversationalRun(run.trigger) || run.status === "waiting_input") ? run : undefined,
      recipient.imageAdmission,
    );
  }
}

/** Intent changes the message representation, never the owned artifact. */
function sendAttachmentBlocks(
  blocks: Extract<MessageBlock, { kind: "image" | "file" }>[],
  artifacts: Array<{ id: string; size: number }>,
  handling: "confirm" | "file" | undefined,
): Extract<MessageBlock, { kind: "image" | "file" }>[] {
  return blocks.map((block) => {
    if (block.kind !== "image") return block;
    if (handling === "file")
      return {
        ...block,
        kind: "file",
        size: artifacts.find((artifact) => artifact.id === block.artifactId)!.size,
      };
    return handling === "confirm" ? { ...block, imageHandling: "confirm" } : block;
  });
}

export async function sendThreadMessage(
  deps: {
    prisma: PrismaClient;
    events: ThreadEvents;
    jobs: JobPublisher;
    imageAdmission?: Parameters<typeof assertThreadImageInput>[5];
    maxAttachmentsPerMessage?: number;
    analytics?: ProductAnalytics;
    sandbox: SandboxProvider;
    notifications?: Parameters<typeof notifyChat>[0]["notifications"];
  },
  actor: Actor,
  target: ChatTarget,
  input: {
    text?: string;
    artifactIds?: string[];
    imageHandling?: "confirm" | "file";
    mentions?: MentionTargetInput[];
    replyToMessageId?: string;
    replyQuote?: string;
    fromPage?: true;
    clientNonce?: string;
  },
  options: {
    /** Settles model setup once Doodle takes the message; false refuses the send. */
    admitDoodle?: () => Promise<boolean>;
    releaseTakeover?: (runId: string) => Promise<void>;
    /** Runs saved with the message, after the thread lock and before the message is routed. */
    startRoutines?: (
      tx: Prisma.TransactionClient,
    ) => Promise<Array<{ id: string; status: string }>>;
  } = {},
) {
  const { releaseTakeover, startRoutines } = options;
  const existing = await replayExistingSend(
    deps,
    target.threadId,
    input.clientNonce,
    releaseTakeover,
  );
  if (existing) return existing;
  const requestedReplyQuote = input.replyQuote?.trim() || undefined;
  if (requestedReplyQuote && !input.replyToMessageId) {
    throw new ORPCError("BAD_REQUEST", { message: "replyQuote requires replyToMessageId." });
  }
  // People-only messages never reach a model, so only one Doodle takes settles model setup.
  // A bare stop needs no model while there is work to stop.
  const takes = await doodleTakesMessage(deps.prisma, actor, target, input);
  const noModel = takes && options.admitDoodle ? !(await options.admitDoodle()) : false;
  if (noModel && !isStopMessage(input)) {
    throw new ORPCError("BAD_REQUEST", { message: MODEL_REQUIRED_SEND_ERROR });
  }

  const commit = () =>
    deps.prisma.$transaction(async (tx) => {
      const author = await loadMessageAuthor(tx, actor.userId);
      let replyToMessageId: string | undefined;
      let replyQuote: string | undefined;
      let replyPreview: ReplyPreview | null | undefined;
      if (input.replyToMessageId) {
        const reply = await tx.message.findFirst({
          where: { id: input.replyToMessageId, threadId: target.threadId },
          select: { id: true, blocks: true, role: true, botId: true, authorUserId: true },
        });
        // A missing target must not lose the send or retain an unverified id.
        // The empty server-owned quote preserves the unavailable state after reload.
        if (!reply) {
          replyQuote = "";
          replyPreview = null;
        } else {
          replyToMessageId = input.replyToMessageId;
          const parsed = MessageBlockSchema.array().safeParse(reply.blocks);
          replyPreview = null;
          if (parsed.success) {
            replyPreview = messageReplyPreview(
              parsed.data,
              reply.role as ReplyPreview["role"],
              reply.botId ?? undefined,
              await loadMessageAuthor(tx, reply.authorUserId),
            );
            // Attachment labels stay in the preview; only selected text is persisted as a quote.
            if (
              !requestedReplyQuote &&
              !replyPreview.attachment &&
              !(input.fromPage && replyPreview.page)
            ) {
              replyQuote = replyPreview.text || undefined;
            }
          }
          // Persist only text derived from the authoritative parent. A
          // mismatch or a derivation failure still sends a plain reply so
          // quote verification cannot lose a message.
          if (requestedReplyQuote && parsed.success) {
            try {
              replyQuote = deriveMessageQuote(
                parsed.data,
                requestedReplyQuote,
                reply.role === "user" ? "plain-text" : "markdown",
              );
            } catch (error) {
              getLogger().error("thread send quote derivation", error);
              replyQuote = undefined;
            }
          }
        }
      }

      const mentionTargets = splitMentionTargets(input.mentions);
      const { blocks: attachmentBlocks, artifacts } = await resolveSendAttachments(
        { prisma: tx, maxAttachmentsPerMessage: deps.maxAttachmentsPerMessage },
        actor,
        target.threadId,
        input.artifactIds,
      );
      const connectorNames = await resolveOwnedConnectorDisplayNames(
        tx,
        actor,
        mentionTargets.connectorMentionIds,
      );
      // Match message counter locking before inspecting runs, without changing counters on rejection.
      await tx.$queryRaw`SELECT id FROM threads WHERE id = ${target.threadId} FOR UPDATE`;
      const routineRuns = (await startRoutines?.(tx)) ?? [];
      // Decided again under the lock: a question asked or a run started meanwhile counts.
      const doodleTakes = takes || (await doodleTakesMessage(tx, actor, target, input));
      const activeRuns = doodleTakes
        ? await tx.run.findMany({
            where: { threadId: target.threadId, status: { in: [...ACTIVE_RUN_STATUSES] } },
            select: {
              id: true,
              taskId: true,
              status: true,
              trigger: true,
              userId: true,
              modelProvider: true,
              modelId: true,
              modelPinned: true,
              thinkingLevel: true,
            },
          })
        : [];
      if (input.imageHandling === "confirm" && doodleTakes) {
        await assertImageRecipients(tx, actor, target, input.text, attachmentBlocks, {
          botId: target.doodleId,
          runs: activeRuns,
          imageAdmission: deps.imageAdmission,
        });
      }
      const blocks = buildUserMessageBlocks(
        input.text,
        sendAttachmentBlocks(attachmentBlocks, artifacts, input.imageHandling),
      );
      const message = await createThreadMessageInTransaction(tx, {
        threadId: target.threadId,
        role: "user",
        authorUserId: actor.userId,
        blocks,
        replyToMessageId,
        replyQuote,
        clientNonce: input.clientNonce,
      });
      const messagePayload = {
        messageId: message.id,
        seq: message.seq,
        role: "user",
        blocks,
        author,
        replyToMessageId,
        replyQuote,
        replyPreview,
      };
      if (!doodleTakes) {
        // Between people: the message and its event, nothing for Doodle.
        const event = await appendEventInTransaction(tx, {
          spaceId: actor.spaceId,
          threadId: target.threadId,
          type: "thread.message.created",
          payload: messagePayload,
        });
        return { message, blocks, runs: [], routineRuns, eventSeq: event.seq };
      }
      // A bare "stop" from the asker while work is active is the Stop button, not a reply.
      const stopping = activeRuns.length > 0 && !routineRuns.length && isStopMessage(input);
      if (noModel && !stopping) {
        throw new ORPCError("BAD_REQUEST", { message: MODEL_REQUIRED_SEND_ERROR });
      }
      const answered: typeof activeRuns = [];
      // Someone else's question stays on its card; this message starts the sender's own run.
      for (const run of activeRuns.filter(
        (run) => !stopping && run.status === "waiting_input" && run.userId === actor.userId,
      )) {
        if (
          await answerWaitingRunWithTextInTransaction(tx, {
            spaceId: actor.spaceId,
            threadId: target.threadId,
            runId: run.id,
            answeredByUserId: actor.userId,
            answer: input.text ?? "",
            beforeMessageSeq: message.seq,
          })
        )
          answered.push({ ...run, status: "queued" });
        else
          await retireWaitingQuestionInTransaction(tx, {
            spaceId: actor.spaceId,
            threadId: target.threadId,
            botId: target.doodleId,
            runId: run.id,
            answer: input.text ?? "",
          });
      }
      if (answered.length) {
        const primary = answered[0];
        if (!primary) throw new IsolationError();
        await tx.message.update({ where: { id: message.id }, data: { runId: primary.id } });
        const steered = answered.filter((run) =>
          answerSteersRun(run, attachmentBlocks, input.imageHandling),
        );
        for (const run of steered) {
          await tx.steeringMessage.create({
            data: {
              messageId: message.id,
              botId: target.doodleId,
              userId: actor.userId,
              runId: run.id,
            },
          });
        }
        const event = await appendEventInTransaction(tx, {
          spaceId: actor.spaceId,
          threadId: target.threadId,
          botId: target.doodleId,
          type: "thread.message.created",
          runId: primary.id,
          payload: { ...messagePayload, runIds: answered.map((run) => run.id) },
        });
        return { message, blocks, runs: answered, routineRuns, eventSeq: event.seq };
      }
      const holdingRuns = stopping
        ? activeRuns
        : activeRuns.filter(
            (run) =>
              QUEUE_HOLDING_RUN_STATUSES.some((status) => status === run.status) &&
              !messageBypassesTakeoverWait(run),
          );
      const active =
        holdingRuns.find((run) => steersMessageFrom(run, actor)) ??
        holdingRuns.find(steersUserMessage) ??
        holdingRuns[0];
      if (active) {
        // Another person's message waits for a run of its own, which acts with their accounts,
        // and is never shown as part of theirs.
        const ownRunId = active.userId === actor.userId ? active.id : null;
        await tx.steeringMessage.create({
          data: {
            messageId: message.id,
            botId: target.doodleId,
            userId: actor.userId,
            runId: steersMessageFrom(active, actor) ? active.id : null,
          },
        });
        if (ownRunId) {
          await tx.message.update({ where: { id: message.id }, data: { runId: ownRunId } });
        }
        const event = await appendEventInTransaction(tx, {
          spaceId: actor.spaceId,
          threadId: target.threadId,
          botId: target.doodleId,
          type: "thread.message.created",
          runId: ownRunId ?? undefined,
          payload: messagePayload,
        });
        if (stopping) {
          const stop = await cancelThreadRuns(actor, target, { botId: target.doodleId })(tx);
          return { message, blocks, runs: [active], routineRuns, eventSeq: event.seq, stop };
        }
        return { message, blocks, runs: [active], routineRuns, eventSeq: event.seq };
      }
      const task = await tx.task.create({
        data: {
          spaceId: actor.spaceId,
          botId: target.doodleId,
          threadId: target.threadId,
          userId: actor.userId,
          prompt: buildSendPrompt(input.text, artifacts, connectorNames),
          status: "queued",
        },
      });
      const run = await tx.run.create({
        data: {
          spaceId: actor.spaceId,
          botId: target.doodleId,
          threadId: target.threadId,
          taskId: task.id,
          userId: actor.userId,
          status: "queued",
          trigger: "user",
          clientNonce: sendRunClientNonce(input.clientNonce, message.id),
          sourceMessageId: message.id,
        },
      });
      await tx.message.update({ where: { id: message.id }, data: { runId: run.id } });
      await cancelSupersededQueuedRuns(tx, { threadId: target.threadId, keepRunIds: [run.id] });
      const event = await appendEventInTransaction(tx, {
        spaceId: actor.spaceId,
        threadId: target.threadId,
        botId: target.doodleId,
        type: "thread.message.created",
        runId: run.id,
        payload: { ...messagePayload, runIds: [run.id] },
      });
      return { message, blocks, runs: [run], routineRuns, eventSeq: event.seq };
    }, THREAD_LOCK_TRANSACTION_OPTIONS);

  const committed = await commit().catch(async (error) => {
    const winner = await replayExistingSend(
      deps,
      target.threadId,
      input.clientNonce,
      releaseTakeover,
    );
    if (winner) return { replay: winner } as const;
    throw error;
  });
  if ("replay" in committed) return committed.replay;
  deps.analytics?.capture(
    actor.userId,
    { name: "message_sent", trigger: "user" },
    { id: committed.message.id, at: committed.message.createdAt },
  );
  await notifyPeopleOfMessage(deps, actor, target, committed.blocks).catch((error) => {
    getLogger().error("chat message notification", error);
  });
  if ("stop" in committed && committed.stop) {
    await finishThreadStop(deps, actor, target, committed.stop);
    return sendResult(committed.message, committed.runs);
  }
  await deps.events.notify(target.threadId, committed.eventSeq).catch((error) => {
    // Subscribers catch up from the durable event cursor after a missed realtime wake.
    getLogger().error("thread send realtime notification", error);
  });
  if (releaseTakeover) {
    for (const run of committed.runs) {
      if (steersMessageFrom(run, actor)) await releaseTakeover(run.id);
    }
  }
  await enqueueRunsNeedingContinue(deps.jobs, [...committed.routineRuns, ...committed.runs]);
  return sendResult(committed.message, committed.runs);
}

const REACTION_TURN_COOLDOWN_MS = 30_000;

/**
 * Append a person's emoji reply with its target. A reaction to Doodle's latest message may
 * wake it, with silence allowed. Only thumbs answer an ordinary pending ask; busy runs, recent
 * reaction turns, and older targets stay quiet context. A 👍 on a pending takeover counts as
 * done and hands computer control back. Approval and secret asks remain on their cards.
 * Reactions are append-only.
 */
export async function reactToThreadMessage(
  deps: { prisma: PrismaClient; jobs: JobPublisher },
  actor: Actor,
  target: ChatTarget,
  input: {
    messageId: string;
    reaction: MessageReaction;
    clientNonce: string;
    /** Settles model setup once the reaction could wake Doodle; false starts no turn. */
    admitDoodle?: () => Promise<boolean>;
  },
  releaseTakeover?: (runId: string) => Promise<void>,
) {
  const parentAuthor = await deps.prisma.message.findFirst({
    where: { id: input.messageId, threadId: target.threadId },
    select: { role: true, authorUserId: true },
  });
  if (!parentAuthor) throw new IsolationError();
  const author = messageAuthor(parentAuthor);
  const mayStartTurn =
    Boolean(author) &&
    doodleReplies({
      kind: "reaction",
      doodle: target.doodle,
      people: target.people,
      senderUserId: actor.userId,
      target: author!,
    }) &&
    (!input.admitDoodle || (await input.admitDoodle()));
  const committed = await deps.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM threads WHERE id = ${target.threadId} FOR UPDATE`;
    const parent = await tx.message.findFirst({
      where: { id: input.messageId, threadId: target.threadId },
      select: { id: true, seq: true, role: true, botId: true, runId: true },
    });
    if (!parent) throw new IsolationError();
    const existing = await tx.message.findUnique({
      where: {
        threadId_clientNonce: { threadId: target.threadId, clientNonce: input.clientNonce },
      },
      select: { id: true },
    });
    if (existing) {
      // A retry finishes a takeover handoff whose release failed after the 👍 was saved.
      const steering = releaseTakeover
        ? await tx.steeringMessage.findFirst({
            where: { messageId: existing.id, claimedAt: null },
            select: { run: { select: { id: true, taskId: true, status: true } } },
          })
        : null;
      const run = steering?.run;
      return { eventSeq: null, runs: run?.status === "waiting_takeover" ? [run] : [] };
    }
    const wakes = mayStartTurn && (await reactionWakesDoodle(tx, target, parent));
    const blocks: MessageBlock[] = [{ kind: "text", text: input.reaction }];
    const authorDto = await loadMessageAuthor(tx, actor.userId);
    const message = await createThreadMessageInTransaction(tx, {
      threadId: target.threadId,
      role: "user",
      authorUserId: actor.userId,
      blocks,
      replyToMessageId: parent.id,
      clientNonce: input.clientNonce,
    });
    const runs = wakes
      ? await startReactionTurn(tx, actor, target.threadId, target.doodleId, parent, message, {
          ...input,
          canReleaseTakeover: Boolean(releaseTakeover),
        })
      : [];
    const event = await appendEventInTransaction(tx, {
      spaceId: actor.spaceId,
      threadId: target.threadId,
      ...(runs[0] ? { botId: target.doodleId, runId: runs[0].id } : {}),
      type: "thread.message.created",
      payload: {
        messageId: message.id,
        role: "user",
        blocks,
        author: authorDto,
        replyToMessageId: parent.id,
        ...(runs.length ? { runIds: runs.map((run) => run.id) } : {}),
      },
    });
    return { eventSeq: event.seq, runs };
  }, THREAD_LOCK_TRANSACTION_OPTIONS);
  if (releaseTakeover) {
    for (const run of committed.runs) {
      if (run.status === "waiting_takeover") await releaseTakeover(run.id);
    }
  }
  await enqueueRunsNeedingContinue(deps.jobs, committed.runs);
  return { eventSeq: committed.eventSeq, runIds: committed.runs.map((run) => run.id) };
}

/** Whether the reaction targets Doodle's newest message; only reactions may follow it. */
async function reactionWakesDoodle(
  tx: Prisma.TransactionClient,
  target: ChatTarget,
  parent: { seq: number; role: string },
) {
  // Only the authenticated human reaction route calls this path.
  if (parent.role !== "bot") return false;
  // Earlier reactions may follow it; any other message means the conversation moved on.
  const newer = await tx.message.findMany({
    where: { threadId: target.threadId, seq: { gt: parent.seq } },
    orderBy: { seq: "asc" },
    take: 51,
    select: { role: true, blocks: true, replyToMessageId: true },
  });
  if (newer.length > 50) return false;
  return newer.every((message) =>
    messageReaction({
      ...message,
      blocks: Array.isArray(message.blocks) ? (message.blocks as MessageBlock[]) : [],
    }),
  );
}

async function startReactionTurn(
  tx: Prisma.TransactionClient,
  actor: Actor,
  threadId: string,
  botId: string,
  parent: { id: string; runId: string | null },
  message: { id: string; seq: number },
  input: { reaction: MessageReaction; clientNonce: string; canReleaseTakeover: boolean },
): Promise<Array<{ id: string; taskId: string; status: string }>> {
  const activeRuns = await tx.run.findMany({
    where: { threadId, botId, status: { in: [...ACTIVE_RUN_STATUSES] } },
    select: { id: true, taskId: true, status: true, userId: true },
  });
  const holdingRuns = activeRuns.filter((run) =>
    QUEUE_HOLDING_RUN_STATUSES.some((status) => status === run.status),
  );
  const active = activeRuns.find((run) => run.id === parent.runId) ?? holdingRuns[0];
  const others = holdingRuns.filter((run) => run.id !== active?.id);
  if (active) {
    // A 👍 while this run waits for the user to finish on the computer means "done", the
    // same as a typed reply: it steers the run and the caller hands control back.
    if (
      input.canReleaseTakeover &&
      input.reaction === "👍" &&
      !others.length &&
      active.status === "waiting_takeover" &&
      active.id === parent.runId &&
      active.userId === actor.userId
    ) {
      await tx.steeringMessage.create({
        data: { messageId: message.id, botId, userId: actor.userId, runId: active.id },
      });
      await tx.message.update({ where: { id: message.id }, data: { runId: active.id } });
      return [active];
    }
    // A question waits for the person whose run asked it, as with a typed answer.
    if (
      (input.reaction === "👍" || input.reaction === "👎") &&
      active.status === "waiting_input" &&
      active.id === parent.runId &&
      active.userId === actor.userId
    ) {
      const answered = await answerWaitingRunWithTextInTransaction(tx, {
        spaceId: actor.spaceId,
        threadId,
        runId: active.id,
        answeredByUserId: actor.userId,
        answer: input.reaction === "👍" ? "yes" : "no",
        messageId: parent.id,
      });
      if (answered) {
        await tx.message.update({ where: { id: message.id }, data: { runId: active.id } });
        return [{ ...active, status: "queued" }];
      }
      // Approval and secret cards still require an explicit card answer.
      return [];
    }
    if (holdingRuns.length) return [];
  }
  // The cooldown limits new turns only, so a quick answer to a pending ask still goes through.
  const recentReaction = await tx.run.findFirst({
    where: {
      threadId,
      botId,
      trigger: "reaction",
      status: { not: "cancelled" },
      createdAt: { gte: new Date(Date.now() - REACTION_TURN_COOLDOWN_MS) },
    },
    select: { id: true },
  });
  if (recentReaction) return [];
  const task = await tx.task.create({
    data: {
      spaceId: actor.spaceId,
      botId,
      threadId,
      userId: actor.userId,
      prompt: input.reaction,
      status: "queued",
    },
  });
  const run = await tx.run.create({
    data: {
      spaceId: actor.spaceId,
      botId,
      threadId,
      taskId: task.id,
      userId: actor.userId,
      status: "queued",
      trigger: "reaction",
      clientNonce: sendRunClientNonce(input.clientNonce, message.id),
      sourceMessageId: message.id,
    },
  });
  await tx.message.update({ where: { id: message.id }, data: { runId: run.id } });
  await cancelSupersededQueuedRuns(tx, { threadId, keepRunIds: [run.id] });
  return [run];
}

/** A bare "stop" or "stop now" with nothing attached: the owner's Stop, sent as text. */
export function isStopMessage(input: { text?: string; artifactIds?: string[] }) {
  const text = (input.text ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  return !input.artifactIds?.length && /^STOP(?: NOW)?[.!?…]*$/.test(text);
}

export const STOPPED_BY_MESSAGE_NOTE = "Stopped. Anything already done stays done.";

export async function stopThreadRuns(
  deps: {
    prisma: PrismaClient;
    sandbox: SandboxProvider;
    events: ThreadEvents;
  },
  actor: Actor,
  target: ChatTarget,
) {
  const stop = await deps.prisma.$transaction(
    cancelThreadRuns(actor, target),
    THREAD_LOCK_TRANSACTION_OPTIONS,
  );
  await finishThreadStop(deps, actor, target, stop);
}

/**
 * Stop's database half, run in the caller's transaction: cancels the thread's active runs and
 * clears its pending steering under the thread lock. `note` says so in the chat when anything
 * was cancelled. Call finishThreadStop after commit.
 */
export function cancelThreadRuns(
  actor: Pick<Actor, "spaceId">,
  target: { threadId: string },
  note?: { botId: string },
) {
  return async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM threads WHERE id = ${target.threadId} FOR UPDATE`;
    const cancelled = await tx.run.updateManyAndReturn({
      where: {
        threadId: target.threadId,
        status: { in: [...ACTIVE_RUN_STATUSES] },
      },
      data: { status: "cancelled", completedAt: new Date() },
      select: { id: true, botId: true, userId: true, spaceId: true },
    });
    const ids = cancelled.map((run) => run.id);
    await clearEndedRunState(tx, ids);
    await tx.steeringMessage.deleteMany({ where: { message: { threadId: target.threadId } } });
    // Snapshot teardown coordinates before commit. Once cancellation becomes
    // visible, a worker can release its lease / execution columns immediately; a
    // later lookup would then miss the sandbox work this request must stop.
    // Team ownership lives on ComputerExecutionLease; Computer.executionRunId is
    // only a legacy secondary path and is not written by current acquisition.
    const leases = ids.length
      ? await tx.computerExecutionLease.findMany({
          where: { runId: { in: ids } },
          select: { computerId: true, runId: true, fence: true },
        })
      : [];
    const leaseComputerIds = [...new Set(leases.map((lease) => lease.computerId))];
    const computers = ids.length
      ? await tx.computer.findMany({
          where:
            leaseComputerIds.length > 0
              ? {
                  OR: [{ id: { in: leaseComputerIds } }, { executionRunId: { in: ids } }],
                }
              : { executionRunId: { in: ids } },
          select: {
            id: true,
            homeKey: true,
            kind: true,
            providerRef: true,
            executionRunId: true,
          },
        })
      : [];
    // One terminal event per cancelled run, in the same commit as the status
    // flip and the progress purge below. Other clients learn the run ended, and
    // the fresh seq keeps max(seq) above every deleted progress row so a client
    // whose cursor pointed at one never discards later refreshes as stale.
    let eventSeq: number | null = null;
    for (const run of cancelled) {
      const event = await appendEventInTransaction(tx, {
        spaceId: actor.spaceId,
        threadId: target.threadId,
        botId: run.botId,
        type: "run.cancelled",
        runId: run.id,
        payload: {},
      });
      eventSeq = event.seq;
    }
    if (ids.length && note) {
      const blocks: MessageBlock[] = [{ kind: "meta", text: STOPPED_BY_MESSAGE_NOTE }];
      const message = await createThreadMessageInTransaction(tx, {
        threadId: target.threadId,
        role: "system",
        blocks,
        botId: note.botId,
      });
      const event = await appendEventInTransaction(tx, {
        spaceId: actor.spaceId,
        threadId: target.threadId,
        botId: note.botId,
        type: "thread.message.created",
        payload: { messageId: message.id, role: "system", blocks },
      });
      eventSeq = event.seq;
    }
    if (ids.length) {
      await tx.event.deleteMany({
        where: {
          ...transientRunEventsWhere(),
          runId: { in: ids },
        },
      });
    }
    return { runIds: ids, computers, leases, eventSeq };
  };
}

/** Stop's after-commit half: wakes subscribers and tears down the cancelled runs' computer work. */
export async function finishThreadStop(
  deps: { prisma: PrismaClient; sandbox: SandboxProvider; events: Pick<ThreadEvents, "notify"> },
  actor: Pick<Actor, "spaceId" | "userId">,
  target: { threadId: string; doodleId: string },
  { runIds, computers, leases, eventSeq }: Awaited<ReturnType<ReturnType<typeof cancelThreadRuns>>>,
) {
  if (eventSeq !== null) {
    // The events are durable; subscribers refetch from their persisted cursor.
    await deps.events.notify(target.threadId, eventSeq).catch((error) => {
      getLogger().error("thread stop realtime notification", error);
    });
  }
  // Keep the DB lease until after teardown so a replacement run cannot claim the
  // screen while we still need the cancelled run's screenLeaseId to release it.
  const computerById = new Map(computers.map((computer) => [computer.id, computer]));
  const teardownTargets: Array<{
    computer: (typeof computers)[number];
    runId: string;
    lease: (typeof leases)[number] | null;
  }> = [];
  const seenTargets = new Set<string>();
  for (const lease of leases) {
    const computer = computerById.get(lease.computerId);
    if (!computer) continue;
    const key = `${computer.id}:${lease.runId}`;
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);
    teardownTargets.push({ computer, runId: lease.runId, lease });
  }
  const cancelledRunIds = new Set(runIds);
  for (const computer of computers) {
    if (!computer.executionRunId) continue;
    // Computers may enter the snapshot via a cancelled lease while
    // Computer.executionRunId still points at an unrelated live run. Only treat
    // the legacy columns as a teardown target when they belong to a run we
    // cancelled in this transaction.
    if (!cancelledRunIds.has(computer.executionRunId)) continue;
    const key = `${computer.id}:${computer.executionRunId}`;
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);
    teardownTargets.push({ computer, runId: computer.executionRunId, lease: null });
  }
  await Promise.all(
    teardownTargets.map(async ({ computer, runId, lease }) => {
      if (!computer.providerRef) return;
      const context = {
        operationId: "stop",
        traceId: "stop",
        spaceId: actor.spaceId,
        userId: actor.userId,
        botId: target.doodleId,
        runId,
        screenLeaseId: screenLeaseIdForRun(lease, runId),
        cancelRunWork: true,
        signal: new AbortController().signal,
      };
      const ref = toComputerRef(computer);
      await cancelComputerRunWork(deps.sandbox, ref, computer.id, runId, context);
      await deps.sandbox.releaseScreen?.(ref, context).catch(() => undefined);
    }),
  );
  await expireComputerExecutionLeases(deps.prisma, { runId: { in: runIds } });
  await deps.prisma.computer.updateMany({
    where: { executionRunId: { in: runIds } },
    data: {
      executionRunId: null,
      executionLeaseExpiresAt: null,
    },
  });
}
