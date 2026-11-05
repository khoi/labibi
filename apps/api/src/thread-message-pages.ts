import type {
  MessageAuthor,
  MessageBlock,
  ThreadMessage,
  ThreadMessagePage,
} from "@labradoodle/contracts";
import { MessageBlock as MessageBlockSchema } from "@labradoodle/contracts";
import {
  BACKGROUND_RUN_TRIGGERS,
  isBackgroundInputBlock,
  isBackgroundRunTrigger,
} from "@labradoodle/core";
import { messageReplyPreview } from "@labradoodle/core/message-quote";
import type { Prisma, PrismaClient } from "@labradoodle/db";
import { loadMessageAuthors } from "@labradoodle/db";

type MessageDb = PrismaClient | Prisma.TransactionClient;

const replySelection = {
  threadId: true,
  role: true,
  botId: true,
  authorUserId: true,
  blocks: true,
} as const;

export async function loadMessagePage(
  prisma: MessageDb,
  threadId: string,
  before: number | undefined,
  pageSize: number,
  around?: { messageId?: string; seq?: number },
  includeBackgroundRuns = false,
): Promise<ThreadMessagePage> {
  if (around) {
    let targetSeq = around.seq;
    if (targetSeq === undefined && around.messageId) {
      const row = await prisma.message.findFirst({
        where: { id: around.messageId, threadId },
        select: { seq: true },
      });
      targetSeq = row?.seq;
    }
    if (targetSeq !== undefined) {
      const half = Math.floor(pageSize / 2);
      const minSeq = Math.max(0, targetSeq - half);
      const maxSeq = targetSeq + half;
      const rows = await prisma.message.findMany({
        where: { threadId, seq: { gte: minSeq, lte: maxSeq } },
        orderBy: { seq: "asc" },
        take: pageSize,
        include: { replyTo: { select: replySelection } },
      });
      const truncated = rows.length >= pageSize;
      const coveredThroughSeq = truncated ? (rows[rows.length - 1]?.seq ?? maxSeq) : maxSeq;
      const first = rows[0];
      const hasOlder = first
        ? (await prisma.message.count({ where: { threadId, seq: { lt: first.seq } } })) > 0
        : false;
      const messages = includeBackgroundRuns
        ? rows
        : await withoutBackgroundRunMessages(prisma, rows);
      return {
        threadId,
        messages: await toThreadMessages(prisma, messages),
        olderCursor: hasOlder ? (first?.seq ?? null) : null,
        coveredThroughSeq,
      };
    }
  }

  let cursor = before;
  while (true) {
    const rows = await prisma.message.findMany({
      where: {
        threadId,
        ...(cursor === undefined ? {} : { seq: { lt: cursor } }),
      },
      orderBy: { seq: "desc" },
      take: pageSize + 1,
      include: { replyTo: { select: replySelection } },
    });
    const hasOlder = rows.length > pageSize;
    const pageRows = rows.slice(0, pageSize).reverse();
    const visibleRows = includeBackgroundRuns
      ? pageRows
      : await withoutBackgroundRunMessages(prisma, pageRows);
    if (visibleRows.length > 0 || !hasOlder) {
      return {
        threadId,
        messages: await toThreadMessages(prisma, visibleRows),
        olderCursor: hasOlder ? (pageRows[0]?.seq ?? null) : null,
      };
    }
    cursor = pageRows[0]?.seq;
  }
}

export async function loadAllMessages(
  prisma: PrismaClient,
  threadId: string,
  pageSize: number,
): Promise<ThreadMessage[]> {
  const pages: ThreadMessage[][] = [];
  let before: number | undefined;
  do {
    const page = await loadMessagePage(prisma, threadId, before, pageSize, undefined, true);
    pages.push(page.messages);
    before = page.olderCursor ?? undefined;
  } while (before !== undefined);
  return pages.reverse().flat();
}

async function withoutBackgroundRunMessages<
  T extends {
    runId: string | null;
    blocks: Prisma.JsonValue;
  },
>(prisma: MessageDb, rows: T[]): Promise<T[]> {
  const runIds = [...new Set(rows.flatMap((row) => (row.runId ? [row.runId] : [])))];
  if (runIds.length === 0) return rows;
  const runs = await prisma.run.findMany({
    where: { id: { in: runIds }, trigger: { in: [...BACKGROUND_RUN_TRIGGERS] } },
    select: { id: true },
  });
  const backgroundRunIds = new Set(runs.map((run) => run.id));
  // Ticket work stays off the transcript except existing user-input cards.
  return rows.filter(
    (row) =>
      !row.runId ||
      !backgroundRunIds.has(row.runId) ||
      (row.blocks as MessageBlock[]).some(isBackgroundInputBlock),
  );
}

export async function isBackgroundRun(
  prisma: MessageDb,
  runId: string | undefined,
  cache: Map<string, Promise<boolean>>,
): Promise<boolean> {
  if (!runId) return false;
  let backgroundRun = cache.get(runId);
  if (!backgroundRun) {
    backgroundRun = prisma.run
      .findUnique({ where: { id: runId }, select: { trigger: true } })
      .then((run) => isBackgroundRunTrigger(run?.trigger));
    cache.set(runId, backgroundRun);
  }
  return backgroundRun;
}

/**
 * A background run's chatter stays off the transcript: no starts, progress, steps,
 * or final text. An open thread still receives the state it needs to answer without
 * a reload — waiting input, computer takeover, and terminal run events — plus the
 * existing user-input cards.
 */
export function shouldForwardBackgroundThreadEvent(event: {
  type: string;
  payload: { blocks?: unknown };
}): boolean {
  if (
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.cancelled" ||
    event.type === "run.waiting_input" ||
    event.type === "computer.takeover.requested"
  ) {
    return true;
  }
  if (event.type !== "thread.message.created" && event.type !== "thread.message.updated") {
    return false;
  }
  const blocks = event.payload.blocks;
  return Array.isArray(blocks) && blocks.some(isBackgroundInputBlock);
}

type MessageRow = {
  id: string;
  threadId: string;
  seq: number;
  role: string;
  blocks: Prisma.JsonValue;
  botId: string | null;
  authorUserId?: string | null;
  replyToMessageId: string | null;
  replyQuote: string | null;
  replyTo?: {
    threadId: string;
    role: string;
    botId: string | null;
    authorUserId?: string | null;
    blocks: Prisma.JsonValue;
  } | null;
  runId: string | null;
  createdAt: Date;
};

async function toThreadMessages(prisma: MessageDb, rows: MessageRow[]): Promise<ThreadMessage[]> {
  const authors = await loadMessageAuthors(
    prisma,
    rows.flatMap((row) => [row.authorUserId, row.replyTo?.authorUserId]),
  );
  return rows.map((row) => toThreadMessage(row, authors));
}

function toThreadMessage(row: MessageRow, authors: Map<string, MessageAuthor>): ThreadMessage {
  const parent = row.replyTo?.threadId === row.threadId ? row.replyTo : null;
  const parsed = parent ? MessageBlockSchema.array().safeParse(parent.blocks) : undefined;
  const replyPreview =
    parent && parsed?.success
      ? messageReplyPreview(
          parsed.data,
          parent.role as ThreadMessage["role"],
          parent.botId ?? undefined,
          parent.authorUserId ? authors.get(parent.authorUserId) : undefined,
        )
      : row.replyToMessageId || row.replyQuote != null
        ? null
        : undefined;
  const author = row.authorUserId ? authors.get(row.authorUserId) : undefined;
  return {
    id: row.id,
    threadId: row.threadId,
    seq: row.seq,
    role: row.role as ThreadMessage["role"],
    blocks: row.blocks as ThreadMessage["blocks"],
    botId: row.botId ?? undefined,
    ...(author ? { author } : {}),
    replyToMessageId: row.replyToMessageId ?? undefined,
    replyQuote: row.replyQuote ?? undefined,
    replyPreview,
    runId: row.runId ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}
