import type { Actor, RunActivityRow } from "@labradoodle/contracts";
import { ACTIVE_RUN_STATUSES, truncatePlainText } from "@labradoodle/core";
import type { PrismaClient } from "@labradoodle/db";
import { listChats } from "@labradoodle/db";

const RECENT_LIMIT = 20;
const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;

function promptSnippet(prompt: string, max = 120): string {
  const oneLine = prompt.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${truncatePlainText(oneLine, max - 1)}…`;
}

/** Doodle's work in the caller's chats; row-level security leaves out chats they are not in. */
export async function listSpaceRuns(
  prisma: PrismaClient,
  actor: Actor,
  filter: "active" | "recent",
): Promise<RunActivityRow[]> {
  const [rows, chats] = await Promise.all([
    prisma.run.findMany({
      where: {
        spaceId: actor.spaceId,
        ...(filter === "active"
          ? { status: { in: [...ACTIVE_RUN_STATUSES] } }
          : { status: { in: [...TERMINAL_STATUSES] } }),
      },
      include: { task: { select: { prompt: true } } },
      orderBy:
        filter === "active"
          ? [{ updatedAt: "desc" }, { id: "desc" }]
          : [{ completedAt: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
      take: filter === "recent" ? RECENT_LIMIT : undefined,
    }),
    listChats(prisma, actor),
  ]);
  const chatById = new Map(chats.map((chat) => [chat.id, chat]));
  return rows.flatMap((row) => {
    const chat = chatById.get(row.threadId);
    if (!chat) return [];
    return [
      {
        runId: row.id,
        threadId: row.threadId,
        title: chat.title,
        status: row.status as RunActivityRow["status"],
        trigger: row.trigger as RunActivityRow["trigger"],
        // The person who asked hears when it finishes, unless they muted the chat.
        notificationsEnabled: row.userId === actor.userId && !chat.muted,
        promptSnippet: promptSnippet(row.task.prompt),
        updatedAt: (filter === "recent" && row.completedAt
          ? row.completedAt
          : row.updatedAt
        ).toISOString(),
      },
    ];
  });
}
