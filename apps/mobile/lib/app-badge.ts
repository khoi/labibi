import * as Notifications from "expo-notifications";

let written: number | null = null;
let generation = 0;

/** Unread chats in the workspace on screen: what the app icon shows. */
export function unreadChatCount(chats: readonly { unread?: boolean }[]): number {
  return chats.filter((chat) => chat.unread).length;
}

/**
 * A push can set the icon while the app is in the background, so the last count written is
 * no longer what the icon shows. The next sync writes the full count again.
 */
export function forgetAppBadge(): void {
  generation += 1;
  written = null;
}

/** Puts the count on the app icon, writing only when it changes. iOS ignores it without permission. */
export async function syncAppBadge(count: number): Promise<void> {
  if (count === written) return;
  written = count;
  const set = await Notifications.setBadgeCountAsync(count).catch(() => false);
  if (!set && written === count) written = null;
}

/** Capture when an inbox request starts; pre-foreground responses cannot overwrite a push. */
export function appBadgeGeneration(): number {
  return generation;
}

export async function syncInboxAppBadge(
  count: number,
  loadedGeneration: number | null,
): Promise<void> {
  if (loadedGeneration !== generation) return;
  await syncAppBadge(count);
}

export async function clearAppBadge(): Promise<void> {
  forgetAppBadge();
  await syncAppBadge(0);
}
