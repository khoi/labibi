import type { RunActivityRow } from "@labradoodle/contracts";
import { isRunWaitingOnUser, isRunWorking } from "./run-state.js";
import { isAgedStuckWork } from "./stuck-work.js";

type ActivityRun = Pick<RunActivityRow, "threadId" | "status" | "updatedAt">;
type ActivityChat = { id: string; unread: boolean };

/** A question or forgotten queue wins over work, and an unread failure is something to look at. */
export function activityAttention(
  run: ActivityRun,
  unread = false,
): "needs_attention" | "working" | "unread" | null {
  if (isRunWaitingOnUser(run.status) || isAgedStuckWork(run.status, run.updatedAt))
    return "needs_attention";
  if (isRunWorking(run.status)) return "working";
  if (!unread) return null;
  return run.status === "failed" ? "needs_attention" : "unread";
}

/** Splits activity into what needs the user, what is running, unread chats, and the rest. */
export function activitySections<Run extends ActivityRun, Chat extends ActivityChat>({
  active,
  recent,
  chats,
}: {
  active: readonly Run[];
  recent: readonly Run[];
  chats: readonly Chat[];
}) {
  const unreadChats = new Set(chats.filter((chat) => chat.unread).map((chat) => chat.id));
  const runUnread = (run: Run) => unreadChats.has(run.threadId);
  // One run speaks for each chat: a question first, then live work, then the latest outcome
  // (`recent` is newest first).
  const byChat = new Map<string, Run>();
  const waiting = active.filter((run) => activityAttention(run) === "needs_attention");
  for (const run of [...waiting, ...active, ...recent]) {
    if (!byChat.has(run.threadId)) byChat.set(run.threadId, run);
  }
  const latest = [...byChat.values()];
  const attention = latest.filter(
    (run) => activityAttention(run, runUnread(run)) === "needs_attention",
  );
  const working = latest.filter((run) => activityAttention(run, runUnread(run)) === "working");
  const busy = new Set([...attention, ...working].map((run) => run.threadId));
  return {
    attention,
    working,
    unreadChats: chats.filter((chat) => chat.unread && !busy.has(chat.id)),
    recent: recent.filter((run) => !attention.includes(run) && !runUnread(run)),
  };
}
