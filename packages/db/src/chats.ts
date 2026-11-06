import type { Chat, ChatMember, MessageBlock } from "@labradoodle/contracts";
import { chatTitle, DOODLE_NAME } from "@labradoodle/core";
import { cancelRunsInTransaction } from "./cancel-runs.js";
import type { Prisma, PrismaClient } from "./client.js";
import type { RunTeardownTarget } from "./computers.js";
import { snapshotRunTeardownTargets } from "./computers.js";
import {
  appendEventInTransaction,
  createPendingSteeringRun,
  transientRunEventsWhere,
} from "./events.js";
import { createThreadMessageInTransaction } from "./messages.js";
import type { PageShareSecret } from "./page-shares.js";
import { deletePageShareSecrets } from "./page-shares.js";
import { threadMessagesByThread } from "./preview-messages.js";
import { runAsSystem } from "./row-security.js";
import { ChatHasOtherPeopleError, IsolationError } from "./scope.js";
import { lockSpaceForContentCreation } from "./spaces.js";
import {
  activeRunSelection,
  activeRunStatuses,
  previewFromBlocks,
  primaryActiveRun,
} from "./thread-listing.js";
import { withTransactionRetry } from "./transaction-retry.js";

/** The person a chat call is for, in the workspace it is made in. */
export type ChatActor = { spaceId: string; userId: string };

export class NotWorkspaceMemberError extends IsolationError {
  constructor() {
    super("Only people in this workspace can be in its chats");
    this.name = "NotWorkspaceMemberError";
  }
}

/** What a change stopped or removed, for the caller to clean up once it commits. */
export type ChatTeardown = {
  cancelledRunIds: string[];
  computers: RunTeardownTarget[];
  /** Stored files of a deleted chat. */
  artifactStorageKeys: string[];
  pageShareSecrets: PageShareSecret[];
  /** Runs for others' requests that waited behind a cancelled run, to start after commit. */
  continuationRunIds: string[];
  /** Newest event seq to fan out, when the chat is still there. */
  seq: number | null;
};

const noTeardown = (): ChatTeardown => ({
  cancelledRunIds: [],
  computers: [],
  artifactStorageKeys: [],
  pageShareSecrets: [],
  continuationRunIds: [],
  seq: null,
});

type Db = PrismaClient | Prisma.TransactionClient;

const chatSelect = {
  id: true,
  spaceId: true,
  name: true,
  doodle: true,
  lastMessageAt: true,
  createdAt: true,
  members: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { userId: true, unread: true, muted: true, lastReadSeq: true },
  },
  runs: activeRunSelection,
} satisfies Prisma.ThreadSelect;

async function peopleById(db: Db, userIds: Iterable<string>) {
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, name: true, image: true },
  });
  return new Map(users.map((user) => [user.id, user]));
}

function chatMembers(
  members: ReadonlyArray<{ userId: string }>,
  people: Map<string, { name: string; image: string | null }>,
): ChatMember[] {
  return members.map(({ userId }) => ({
    userId,
    name: people.get(userId)?.name ?? "",
    image: people.get(userId)?.image ?? null,
  }));
}

/** The viewer's chats matching `where`, most recent activity first. Works in any context. */
async function loadChats(
  prisma: PrismaClient,
  actor: ChatActor,
  where: Prisma.ThreadWhereInput = {},
): Promise<Chat[]> {
  const rows = await prisma.thread.findMany({
    where: { ...where, spaceId: actor.spaceId, members: { some: { userId: actor.userId } } },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    select: chatSelect,
  });
  const ids = rows.map((row) => row.id);
  // A solo chat without a name is titled by its first message.
  const untitled = rows.filter((row) => !row.name && row.members.length === 1).map((row) => row.id);
  const [people, newest, first] = await Promise.all([
    peopleById(
      prisma,
      rows.flatMap((row) => row.members.map((member) => member.userId)),
    ),
    threadMessagesByThread(prisma, ids, { limit: 1 }),
    threadMessagesByThread(prisma, untitled, { limit: 1, oldest: true, role: "user" }),
  ]);
  return rows.map((row) => {
    const viewer = row.members.find((member) => member.userId === actor.userId);
    if (!viewer) throw new IsolationError();
    const members = chatMembers(row.members, people);
    return {
      id: row.id,
      spaceId: row.spaceId,
      name: row.name,
      title: chatTitle(
        {
          name: row.name,
          people: members,
          firstMessage: previewFromBlocks(first.get(row.id)?.[0]?.blocks),
        },
        actor.userId,
      ),
      doodle: row.doodle,
      members,
      preview: previewFromBlocks(newest.get(row.id)?.[0]?.blocks),
      status: primaryActiveRun(row.runs)?.status ?? "idle",
      unread: viewer.unread,
      muted: viewer.muted,
      lastReadSeq: viewer.lastReadSeq,
      lastMessageAt: row.lastMessageAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  });
}

/** The caller's chats in this workspace, most recent activity first. */
export function listChats(prisma: PrismaClient, actor: ChatActor): Promise<Chat[]> {
  return loadChats(prisma, actor);
}

export async function getChat(
  prisma: PrismaClient,
  actor: ChatActor,
  threadId: string,
): Promise<Chat> {
  const [chat] = await loadChats(prisma, actor, { id: threadId });
  if (!chat) throw new IsolationError();
  return chat;
}

/** The chat when the caller is in it; otherwise not found, whoever else they are. */
export async function requireChatMember(db: Db, actor: ChatActor, threadId: string) {
  const thread = await db.thread.findFirst({
    where: {
      id: threadId,
      spaceId: actor.spaceId,
      members: { some: { userId: actor.userId } },
    },
    select: { id: true, spaceId: true, userId: true, name: true, doodle: true },
  });
  if (!thread) throw new IsolationError();
  return thread;
}

/** Serializes changes to one chat's people and Doodle; only someone in it gets the lock. */
async function lockChat(tx: Prisma.TransactionClient, actor: ChatActor, threadId: string) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT t.id FROM threads t
    JOIN thread_members m ON m."threadId" = t.id AND m."userId" = ${actor.userId}
    WHERE t.id = ${threadId} AND t."spaceId" = ${actor.spaceId}
    FOR UPDATE OF t`;
  if (locked.length !== 1) throw new IsolationError();
}

async function requireWorkspaceMembers(
  tx: Prisma.TransactionClient,
  spaceId: string,
  userIds: readonly string[],
) {
  if (userIds.length === 0) return;
  const found = await tx.spaceMember.count({ where: { spaceId, userId: { in: [...userIds] } } });
  if (found !== userIds.length) throw new NotWorkspaceMemberError();
}

/**
 * A chat with its creator, these people and, when asked, Doodle. Run as system, since nobody is
 * in the chat yet, under the caller's space content lock.
 */
async function insertChat(
  tx: Prisma.TransactionClient,
  actor: ChatActor,
  input: { name?: string | null; userIds: readonly string[]; doodle: boolean },
): Promise<string> {
  const others = [...new Set(input.userIds)].filter((userId) => userId !== actor.userId);
  await requireWorkspaceMembers(tx, actor.spaceId, others);
  const thread = await tx.thread.create({
    data: {
      spaceId: actor.spaceId,
      userId: actor.userId,
      name: input.name?.trim() || null,
      doodle: input.doodle,
    },
    select: { id: true },
  });
  await tx.threadMember.createMany({
    data: [actor.userId, ...others].map((userId) => ({
      threadId: thread.id,
      spaceId: actor.spaceId,
      userId,
    })),
  });
  return thread.id;
}

export async function createChat(
  prisma: PrismaClient,
  actor: ChatActor,
  input: { name?: string | null; userIds: readonly string[]; doodle: boolean },
): Promise<Chat> {
  const threadId = await runAsSystem("create a chat with its people", () =>
    withTransactionRetry(() =>
      prisma.$transaction(async (tx) => {
        await lockSpaceForContentCreation(tx, actor);
        return insertChat(tx, actor, input);
      }),
    ),
  );
  return getChat(prisma, actor, threadId);
}

/**
 * A new person's first chat, with Doodle in it, unless they already have one in this workspace.
 * Returns its id, or null when they had one.
 */
export async function ensureFirstChat(
  prisma: PrismaClient,
  actor: ChatActor,
): Promise<string | null> {
  return runAsSystem("give a new person their first chat", () =>
    withTransactionRetry(() =>
      prisma.$transaction(async (tx) => {
        await lockSpaceForContentCreation(tx, actor);
        const mine = { spaceId: actor.spaceId, userId: actor.userId };
        if (await tx.threadMember.count({ where: mine, take: 1 })) return null;
        return insertChat(tx, actor, { userIds: [], doodle: true });
      }),
    ),
  );
}

/**
 * Until a person writes in a workspace, their chat alone with Doodle there, made if missing,
 * so it can be welcomed. Returns null once they have written anything in the workspace.
 */
export async function ensureWelcomeChat(
  prisma: PrismaClient,
  actor: ChatActor,
): Promise<string | null> {
  return runAsSystem("find or make a new person's welcome chat", () =>
    withTransactionRetry(() =>
      prisma.$transaction(async (tx) => {
        const wrote = await tx.message.findFirst({
          where: { authorUserId: actor.userId, thread: { spaceId: actor.spaceId } },
          select: { id: true },
        });
        if (wrote) return null;
        await lockSpaceForContentCreation(tx, actor);
        const solo = await tx.thread.findFirst({
          where: {
            spaceId: actor.spaceId,
            doodle: true,
            members: { every: { userId: actor.userId }, some: { userId: actor.userId } },
          },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        return solo?.id ?? (await insertChat(tx, actor, { userIds: [], doodle: true }));
      }),
    ),
  );
}

/** Only people of the workspace; anyone in the chat may add them, and they see its history. */
export async function addChatMembers(
  prisma: PrismaClient,
  actor: ChatActor,
  input: { threadId: string; userIds: readonly string[] },
): Promise<Chat> {
  await withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      await lockChat(tx, actor, input.threadId);
      const userIds = [...new Set(input.userIds)];
      await requireWorkspaceMembers(tx, actor.spaceId, userIds);
      await tx.threadMember.createMany({
        data: userIds.map((userId) => ({
          threadId: input.threadId,
          spaceId: actor.spaceId,
          userId,
        })),
        skipDuplicates: true,
      });
    }),
  );
  return getChat(prisma, actor, input.threadId);
}

export async function renameChat(
  prisma: PrismaClient,
  actor: ChatActor,
  input: { threadId: string; name: string | null },
): Promise<Chat> {
  await requireChatMember(prisma, actor, input.threadId);
  await prisma.thread.update({
    where: { id: input.threadId },
    data: { name: input.name?.trim() || null },
  });
  return getChat(prisma, actor, input.threadId);
}

/** Cancels these runs and records it in their chat; returns what they held. */
async function cancelChatRuns(
  tx: Prisma.TransactionClient,
  input: { spaceId: string; threadId: string },
  where: Prisma.RunWhereInput,
) {
  const runs = await tx.run.findMany({
    where: { ...where, threadId: input.threadId, status: { in: activeRunStatuses } },
    select: { id: true, taskId: true, userId: true, spaceId: true, botId: true },
  });
  const cancelled = await cancelRunsInTransaction(tx, runs, new Date());
  const runIds = cancelled.map((run) => run.id);
  // Snapshot after cancelling, before commit: the run row locks keep these runs from
  // acquiring a computer, and an expired lease not yet reclaimed still names a screen.
  const { targets } = await snapshotRunTeardownTargets(tx, runIds);
  let seq: number | null = null;
  if (runIds.length) {
    await tx.event.deleteMany({ where: { ...transientRunEventsWhere(), runId: { in: runIds } } });
    for (const run of cancelled) {
      const event = await appendEventInTransaction(tx, {
        spaceId: input.spaceId,
        threadId: input.threadId,
        botId: run.botId,
        runId: run.id,
        type: "run.cancelled",
        payload: {},
      });
      seq = event.seq;
    }
  }
  const botIds = [...new Set(cancelled.map((run) => run.botId))];
  return { cancelledRunIds: runIds, computers: targets, seq, botIds };
}

/** A visible line in the chat, such as Doodle joining. */
async function postChatNote(
  tx: Prisma.TransactionClient,
  input: { spaceId: string; threadId: string; text: string },
): Promise<number> {
  const blocks: MessageBlock[] = [{ kind: "meta", text: input.text }];
  const message = await createThreadMessageInTransaction(tx, {
    threadId: input.threadId,
    role: "system",
    blocks,
  });
  const event = await appendEventInTransaction(tx, {
    spaceId: input.spaceId,
    threadId: input.threadId,
    type: "thread.message.created",
    payload: { messageId: message.id, role: "system", blocks },
  });
  return event.seq;
}

/**
 * Anyone in the chat turns Doodle on or off, with a line saying so. Off stops Doodle's work here:
 * its runs are cancelled, follow-ups waiting for it are dropped, and the chat's routines pause.
 */
export async function setChatDoodle(
  prisma: PrismaClient,
  actor: ChatActor,
  input: { threadId: string; doodle: boolean },
): Promise<{ chat: Chat; teardown: ChatTeardown }> {
  const teardown = await withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      await lockChat(tx, actor, input.threadId);
      const { doodle } = await tx.thread.findUniqueOrThrow({
        where: { id: input.threadId },
        select: { doodle: true },
      });
      if (doodle === input.doodle) return noTeardown();
      await tx.thread.update({ where: { id: input.threadId }, data: { doodle: input.doodle } });
      const stopped = input.doodle
        ? { cancelledRunIds: [], computers: [] }
        : await cancelChatRuns(tx, { spaceId: actor.spaceId, threadId: input.threadId }, {});
      if (!input.doodle) {
        await tx.steeringMessage.deleteMany({
          where: { message: { threadId: input.threadId }, claimedAt: null },
        });
        await tx.routine.updateMany({
          where: { threadId: input.threadId, active: true },
          data: { active: false, nextRunAt: null },
        });
      }
      const seq = await postChatNote(tx, {
        spaceId: actor.spaceId,
        threadId: input.threadId,
        text: `${DOODLE_NAME} ${input.doodle ? "joined" : "left"}`,
      });
      return {
        ...noTeardown(),
        cancelledRunIds: stopped.cancelledRunIds,
        computers: stopped.computers,
        seq,
      };
    }),
  );
  return { chat: await getChat(prisma, actor, input.threadId), teardown };
}

/**
 * Deletes these chats of the workspace and everything in them, inside the caller's transaction;
 * returns what the caller removes after commit.
 */
export async function deleteChatsInTransaction(
  tx: Prisma.TransactionClient,
  spaceId: string,
  threadIds: readonly string[],
): Promise<ChatTeardown> {
  if (threadIds.length === 0) return noTeardown();
  const where = { threadId: { in: [...threadIds] } };
  const runs = await tx.run.findMany({
    where: { ...where, status: { in: activeRunStatuses } },
    select: { id: true, taskId: true, userId: true, spaceId: true },
  });
  const cancelledRunIds = (await cancelRunsInTransaction(tx, runs, new Date())).map(
    (run) => run.id,
  );
  // The runs cascade away with the chat, but their computer leases don't.
  const { targets } = await snapshotRunTeardownTargets(tx, cancelledRunIds);
  const artifacts = await tx.artifact.findMany({ where, select: { storageKey: true } });
  const pageShareSecrets = await deletePageShareSecrets(tx, where);
  // Routines cascade with their chat; their webhook secrets would not.
  const webhookSecrets = await tx.routine.findMany({
    where: { ...where, webhookSecretId: { not: null } },
    select: { webhookSecretId: true },
  });
  await tx.thread.deleteMany({ where: { id: { in: [...threadIds] }, spaceId } });
  if (webhookSecrets.length) {
    await tx.secret.deleteMany({
      where: {
        id: { in: webhookSecrets.flatMap((row) => row.webhookSecretId ?? []) },
        kind: "webhook",
      },
    });
  }
  return {
    cancelledRunIds,
    computers: targets,
    artifactStorageKeys: artifacts.map((artifact) => artifact.storageKey),
    pageShareSecrets,
    continuationRunIds: [],
    seq: null,
  };
}

/**
 * The caller leaves; their messages stay. What ran with their accounts here stops: their runs
 * are cancelled, their waiting follow-ups dropped, and their routines pause. Others' requests
 * that waited behind those runs start now. The last person to leave deletes the chat.
 */
export async function leaveChat(
  prisma: PrismaClient,
  actor: ChatActor,
  threadId: string,
): Promise<ChatTeardown> {
  return withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      await lockChat(tx, actor, threadId);
      if ((await tx.threadMember.count({ where: { threadId } })) === 1) {
        return deleteChatsInTransaction(tx, actor.spaceId, [threadId]);
      }
      const { botIds, ...stopped } = await cancelChatRuns(
        tx,
        { spaceId: actor.spaceId, threadId },
        { userId: actor.userId },
      );
      await tx.steeringMessage.deleteMany({
        where: { userId: actor.userId, message: { threadId } },
      });
      const continuationRunIds: string[] = [];
      for (const botId of botIds) {
        const id = await createPendingSteeringRun(tx, { spaceId: actor.spaceId, threadId, botId });
        if (id) continuationRunIds.push(id);
      }
      await tx.routine.updateMany({
        where: { threadId, userId: actor.userId },
        data: { active: false, nextRunAt: null },
      });
      await tx.threadMember.delete({
        where: { threadId_userId: { threadId, userId: actor.userId } },
      });
      return { ...noTeardown(), ...stopped, continuationRunIds };
    }),
  );
}

/** Only a chat with no one else in it, Doodle aside. */
export async function deleteChat(
  prisma: PrismaClient,
  actor: ChatActor,
  threadId: string,
): Promise<ChatTeardown> {
  return withTransactionRetry(() =>
    prisma.$transaction(async (tx) => {
      await lockChat(tx, actor, threadId);
      const others = await tx.threadMember.count({
        where: { threadId, userId: { not: actor.userId } },
      });
      if (others > 0) throw new ChatHasOtherPeopleError();
      return deleteChatsInTransaction(tx, actor.spaceId, [threadId]);
    }),
  );
}

async function requireOwnMembership(db: Db, actor: ChatActor, threadId: string) {
  const member = await db.threadMember.findUnique({
    where: { threadId_userId: { threadId, userId: actor.userId } },
    select: { spaceId: true, unread: true, lastReadSeq: true },
  });
  if (!member || member.spaceId !== actor.spaceId) throw new IsolationError();
  return member;
}

/** `unreadAfterSeq`: the seq read up to before this call, null when nothing was unread. */
export async function markChatRead(
  prisma: PrismaClient,
  actor: ChatActor,
  threadId: string,
): Promise<{ unreadAfterSeq: number | null }> {
  return prisma.$transaction(async (tx) => {
    const member = await requireOwnMembership(tx, actor, threadId);
    const { nextMessageSeq } = await tx.thread.findUniqueOrThrow({
      where: { id: threadId },
      select: { nextMessageSeq: true },
    });
    await tx.threadMember.update({
      where: { threadId_userId: { threadId, userId: actor.userId } },
      data: { unread: false, lastReadSeq: nextMessageSeq - 1 },
    });
    return { unreadAfterSeq: member.unread ? member.lastReadSeq : null };
  });
}

/** With `messageId`, the chat reads as unread from that message: the next open puts New above it. */
export async function markChatUnread(
  prisma: PrismaClient,
  actor: ChatActor,
  input: { threadId: string; messageId?: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await requireOwnMembership(tx, actor, input.threadId);
    const message = input.messageId
      ? await tx.message.findFirst({
          where: { id: input.messageId, threadId: input.threadId },
          select: { seq: true },
        })
      : null;
    if (input.messageId && !message) throw new IsolationError();
    await tx.threadMember.update({
      where: { threadId_userId: { threadId: input.threadId, userId: actor.userId } },
      data: { unread: true, ...(message ? { lastReadSeq: message.seq - 1 } : {}) },
    });
  });
}

export async function setChatMuted(
  prisma: PrismaClient,
  actor: ChatActor,
  input: { threadId: string; muted: boolean },
): Promise<void> {
  const { count } = await prisma.threadMember.updateMany({
    where: { threadId: input.threadId, userId: actor.userId, spaceId: actor.spaceId },
    data: { muted: input.muted },
  });
  if (count !== 1) throw new IsolationError();
}

/** The people in a chat the caller is in, in the order they joined. */
export async function listChatMembers(
  prisma: PrismaClient,
  actor: ChatActor,
  threadId: string,
): Promise<ChatMember[]> {
  await requireChatMember(prisma, actor, threadId);
  const members = await prisma.threadMember.findMany({
    where: { threadId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { userId: true },
  });
  return chatMembers(
    members,
    await peopleById(
      prisma,
      members.map((member) => member.userId),
    ),
  );
}

/** A routine runs with its creator's accounts, so once they leave its chat nobody else revives it. */
export async function routineCreatorInChat(
  db: Pick<Db, "threadMember">,
  routine: { threadId: string; userId: string },
): Promise<boolean> {
  const member = await db.threadMember.findUnique({
    where: { threadId_userId: { threadId: routine.threadId, userId: routine.userId } },
    select: { id: true },
  });
  return Boolean(member);
}

export const ROUTINE_CREATOR_LEFT_ERROR =
  "The person who made this routine left the chat, so it stays paused. Make a new one instead.";
