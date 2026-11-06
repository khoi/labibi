import type { Actor, MessageBlock } from "@labradoodle/contracts";
import type { Prisma, PrismaClient, ThreadEvents } from "@labradoodle/db";
import { appendEventInTransaction } from "@labradoodle/db";
import { resolveChatTarget } from "./thread-target.js";

export type BotThreadDeps = {
  prisma: PrismaClient;
  events: ThreadEvents;
};

/** A chat the caller is in, with the workspace's Doodle that posts there. */
export async function requireChatDoodle(deps: BotThreadDeps, actor: Actor, threadId: string) {
  const target = await resolveChatTarget(deps.prisma, actor, { threadId });
  return { bot: { id: target.doodleId }, thread: { id: target.threadId } };
}

export async function updateBlocks(
  deps: BotThreadDeps,
  target: { spaceId: string; botId: string; threadId: string },
  messageId: string,
  blocks: MessageBlock[],
): Promise<void> {
  const event = await deps.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.message.update({ where: { id: messageId }, data: { blocks } });
    return appendEventInTransaction(tx, {
      spaceId: target.spaceId,
      threadId: target.threadId,
      botId: target.botId,
      type: "thread.message.updated",
      payload: { messageId, role: "bot", blocks },
    });
  });
  await deps.events.notify(target.threadId, event.seq);
}
