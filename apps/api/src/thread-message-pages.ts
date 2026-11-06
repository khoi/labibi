import type { MessageAuthor, ThreadMessage, ThreadMessagePage } from "@labradoodle/contracts";
import { MessageBlock as MessageBlockSchema } from "@labradoodle/contracts";
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
      return {
        threadId,
        messages: await toThreadMessages(prisma, rows),
        olderCursor: hasOlder ? (first?.seq ?? null) : null,
        coveredThroughSeq,
      };
    }
  }

  const rows = await prisma.message.findMany({
    where: {
      threadId,
      ...(before === undefined ? {} : { seq: { lt: before } }),
    },
    orderBy: { seq: "desc" },
    take: pageSize + 1,
    include: { replyTo: { select: replySelection } },
  });
  const hasOlder = rows.length > pageSize;
  const pageRows = rows.slice(0, pageSize).reverse();
  return {
    threadId,
    messages: await toThreadMessages(prisma, pageRows),
    olderCursor: hasOlder ? (pageRows[0]?.seq ?? null) : null,
  };
}

export async function loadAllMessages(
  prisma: PrismaClient,
  threadId: string,
  pageSize: number,
): Promise<ThreadMessage[]> {
  const pages: ThreadMessage[][] = [];
  let before: number | undefined;
  do {
    const page = await loadMessagePage(prisma, threadId, before, pageSize);
    pages.push(page.messages);
    before = page.olderCursor ?? undefined;
  } while (before !== undefined);
  return pages.reverse().flat();
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
