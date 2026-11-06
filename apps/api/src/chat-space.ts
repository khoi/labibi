import type { Actor } from "@labradoodle/contracts";
import type { PrismaClient } from "@labradoodle/db";
import { runAsSystem } from "@labradoodle/db";

/** The other workspace holding one of the caller's chats, among those they still belong to. */
export function otherSpaceOfChat(
  prisma: PrismaClient,
  actor: Actor,
  threadId: string,
): Promise<string | undefined> {
  return runAsSystem("find which of the caller's workspaces holds their chat", async () => {
    const member = await prisma.threadMember.findFirst({
      where: {
        threadId,
        userId: actor.userId,
        spaceId: { not: actor.spaceId },
        spaceMember: { space: { deletingAt: null } },
      },
      select: { spaceId: true },
    });
    return member?.spaceId;
  });
}
