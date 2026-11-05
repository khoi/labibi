import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { contentEncryptionOf } from "./content-encryption.js";

/** Scalar columns a chat preview and its older-page fallback both read. */
export interface SidebarPreviewMessage {
  id: string;
  threadId: string;
  seq: number;
  role: string;
  blocks: Prisma.JsonValue;
  botId: string | null;
  replyToMessageId: string | null;
  replyQuote: string | null;
  runId: string | null;
  clientNonce: string | null;
  createdAt: Date;
}

/**
 * One indexed read of the newest (or, with `oldest`, the first) `limit` messages of each
 * thread, optionally of one role. A nested `take` on `findMany` is applied in memory and would
 * load every message.
 */
export async function threadMessagesByThread(
  prisma: PrismaClient,
  threadIds: readonly string[],
  options: { limit: number; oldest?: boolean; role?: string },
): Promise<Map<string, SidebarPreviewMessage[]>> {
  const byThread = new Map<string, SidebarPreviewMessage[]>();
  if (threadIds.length === 0) return byThread;
  const order = options.oldest ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const role = options.role ? Prisma.sql`AND role = ${options.role}` : Prisma.empty;
  const loaded = await prisma.$queryRaw<SidebarPreviewMessage[]>(Prisma.sql`
    SELECT m.id, m."threadId", m.seq, m.role, m.blocks, m."botId",
      m."replyToMessageId", m."replyQuote", m."runId", m."clientNonce", m."createdAt"
    FROM unnest(${[...threadIds]}::text[]) AS t(id)
    CROSS JOIN LATERAL (
      SELECT id, "threadId", seq, role, blocks, "botId", "replyToMessageId", "replyQuote",
        "runId", "clientNonce", "createdAt"
      FROM messages
      WHERE "threadId" = t.id ${role}
      ORDER BY seq ${order}
      LIMIT ${options.limit}
    ) m
    ORDER BY m."threadId", m.seq ${order}
  `);
  const opened = (await contentEncryptionOf(prisma)?.openRows("Message", loaded)) ?? loaded;
  for (const row of opened) {
    const list = byThread.get(row.threadId);
    if (list) list.push(row);
    else byThread.set(row.threadId, [row]);
  }
  return byThread;
}
