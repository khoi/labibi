import type { MobileChat } from "./api";

export type InboxRowAction = "read" | "unread" | "mute" | "unmute" | "leave" | "delete";

export const INBOX_ROW_ACTIONS = {
  read: { label: "Mark as Read", systemImage: "checkmark.message.fill" },
  unread: { label: "Mark as Unread", systemImage: "message.badge.filled.fill" },
  mute: { label: "Silence notifications", systemImage: "bell.slash" },
  unmute: { label: "Resume notifications", systemImage: "bell" },
  leave: { label: "Leave chat", systemImage: "rectangle.portrait.and.arrow.right" },
  delete: { label: "Delete chat", systemImage: "trash" },
} as const satisfies Record<InboxRowAction, { label: string; systemImage: string }>;

/** Swipe right toggles read state. */
export function inboxReadAction(chat: { unread?: boolean }): InboxRowAction {
  return chat.unread ? "read" : "unread";
}

/** A chat with only you can be deleted; with other people you can only leave it. */
export function chatHasOthers(
  chat: Pick<MobileChat, "members">,
  viewerUserId: string | undefined,
): boolean {
  return chat.members.some((member) => member.userId !== viewerUserId);
}

/** The row's menu: read state, notifications, then leaving or deleting the chat. */
export function inboxRowActions(
  chat: Pick<MobileChat, "unread" | "muted" | "members">,
  viewerUserId: string | undefined,
): InboxRowAction[] {
  return [
    inboxReadAction(chat),
    chat.muted ? "unmute" : "mute",
    chatHasOthers(chat, viewerUserId) ? "leave" : "delete",
  ];
}

/** Shows read state the user just changed until its request settles, so a poll can't undo it. */
export function applyUnreadOverrides<T extends { id: string; unread?: boolean }>(
  chats: T[],
  overrides: ReadonlyMap<string, boolean>,
): T[] {
  if (overrides.size === 0) return chats;
  return chats.map((chat) => {
    const unread = overrides.get(chat.id);
    return unread === undefined || unread === chat.unread ? chat : { ...chat, unread };
  });
}

/**
 * Sends one request per key at a time. A value chosen while one is in flight waits and only
 * the latest choice is sent next, so overlapping swipes can't reach the server out of order.
 * `settled` runs synchronously once nothing is left to send, or after a failure.
 */
export function createLatestQueue<T>() {
  const latest = new Map<string, T>();
  return async function send(
    key: string,
    value: T,
    request: (value: T) => Promise<void>,
    settled: () => void,
  ): Promise<void> {
    const running = latest.has(key);
    latest.set(key, value);
    if (running) return;
    try {
      for (;;) {
        const next = latest.get(key) as T;
        await request(next);
        if (latest.get(key) === next) return;
      }
    } finally {
      latest.delete(key);
      settled();
    }
  };
}
