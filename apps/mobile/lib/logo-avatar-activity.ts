import type { ThreadSnapshot } from "@labradoodle/contracts";
import type { LogoAvatarActivitySnapshot } from "@labradoodle/core";
import { createLogoAvatarActivityStore } from "@labradoodle/core";

const projection = createLogoAvatarActivityStore();
const snapshots = new Map<string, { value: LogoAvatarActivitySnapshot; order: number }>();
let snapshotOrder = 0;
let sessionScope = "";
let serial = 0;
export const mobileLogoAvatarActivity = {
  ...projection,
  clear() {
    snapshots.clear();
    projection.clear();
  },
};
export function syncMobileAvatarSession(apiBase: string, generation: number) {
  const scope = `${generation}:${apiBase}`;
  if (scope === sessionScope) return;
  sessionScope = scope;
  mobileLogoAvatarActivity.clear();
}
export const newMobileAvatarSnapshotRequest = () => ++snapshotOrder;
/**
 * Doodle is one assistant in many chats, so its activity is kept per chat: a run's "bot" here is
 * the chat it runs in, and an inbox row reads its chat's activity by the chat id.
 */
export function rememberMobileAvatarSnapshot(
  snapshot: Pick<ThreadSnapshot, "threadId" | "cursor" | "run" | "activeRuns">,
  order = newMobileAvatarSnapshotRequest(),
) {
  const key = snapshot.threadId;
  const previous = snapshots.get(key);
  if (
    previous &&
    (previous.order > order ||
      (previous.value.threadId === snapshot.threadId && previous.value.cursor > snapshot.cursor))
  )
    return;
  // Keep only current run metadata, never message contents or historical tool rows.
  const perChat = <T extends { botId: string }>(run: T): T => ({ ...run, botId: key });
  const value = {
    threadId: key,
    cursor: snapshot.cursor,
    botId: key,
    run: snapshot.run ? perChat(snapshot.run) : null,
    activeRuns: snapshot.activeRuns?.map(perChat),
  };
  snapshots.set(key, { order, value });
  projection.reconcile(value);
  if (snapshots.size > 100) snapshots.delete(snapshots.keys().next().value!);
}
export function beginMobileAvatarFeed(threadId: string, cursor: number) {
  const source = `mobile-avatar-${++serial}`;
  const snapshot = snapshots.get(threadId)?.value;
  // A snapshot older than the feed cursor misses runs started since, so it can't vouch for idle.
  if (snapshot && snapshot.cursor >= cursor) projection.hydrate(source, snapshot);
  return { source };
}
