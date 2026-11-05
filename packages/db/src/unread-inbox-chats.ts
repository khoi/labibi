import type { PrismaClient } from "./client.js";
import { runAsSystem } from "./row-security.js";

/** Counts the person's unread, unmuted chats across every workspace they belong to. */
export function countUnreadInboxChats(
  prisma: PrismaClient,
  { userId }: { userId: string },
): Promise<number> {
  // Read state is a chat row; this counts only the person's own, across their workspaces.
  return runAsSystem("count unread inbox chats across the member's Spaces", () =>
    prisma.threadMember.count({
      where: { userId, unread: true, muted: false, spaceMember: { space: { deletingAt: null } } },
    }),
  );
}
