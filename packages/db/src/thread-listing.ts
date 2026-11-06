import { ACTIVE_RUN_STATUSES, plainTextFromMarkdown } from "@labradoodle/core";

export const activeRunStatuses = [...ACTIVE_RUN_STATUSES];

/** Active runs for a chat's status in the list. */
export const activeRunSelection = {
  where: { status: { in: activeRunStatuses } },
  orderBy: { createdAt: "desc" as const },
  select: { status: true, threadId: true },
} as const;

/** Waiting, running, then leased work wins over queued work, regardless of creation order. */
export function primaryActiveRun<T extends { status: string }>(runs: readonly T[]): T | undefined {
  return (
    runs.find((run) => run.status === "waiting_takeover" || run.status === "waiting_input") ??
    runs.find((run) => run.status === "running") ??
    runs.find((run) => run.status === "leased") ??
    runs[0]
  );
}

export function threadRunStatus(
  runs: readonly { status: string; threadId: string }[],
  threadId: string,
): string {
  return primaryActiveRun(runs.filter((run) => run.threadId === threadId))?.status ?? "idle";
}

export function previewFromBlocks(blocks: unknown): string {
  const rows = Array.isArray(blocks) ? blocks : [];
  for (const block of rows) {
    if (
      block &&
      typeof block === "object" &&
      "text" in block &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      return plainTextFromMarkdown((block as { text: string }).text);
    }
  }
  return "";
}
