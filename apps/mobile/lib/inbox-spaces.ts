import { logoAvatarNeedsAttention } from "@labradoodle/core";
import type { MobileChat } from "./api";
import { selectSpace } from "./api";
import { mobileLogoAvatarActivity } from "./logo-avatar-activity";
import type { InboxSignal } from "./offscreen-unreads";

export function inboxItemKey(chat: MobileChat): string {
  return chat.id;
}

/** What a row adds to the off-screen unread pills: unread, and Doodle waiting on you. */
export function inboxSignal(chat: MobileChat): InboxSignal {
  return {
    unread: chat.unread ? 1 : 0,
    attention:
      chat.doodle &&
      logoAvatarNeedsAttention(mobileLogoAvatarActivity.getActivity(chat.id, chat.status))
        ? 1
        : 0,
  };
}

export async function selectInboxSpace(spaceId: string, refresh: () => Promise<void>) {
  if (!(await selectSpace(spaceId).catch(() => false))) return false;
  await refresh();
  return true;
}
