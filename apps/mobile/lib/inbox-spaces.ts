import type { SpaceBot, SpaceGroup } from "@labradoodle/contracts";
import { botAvatarActivity, logoAvatarNeedsAttention } from "@labradoodle/core";
import type { MobileBot, MobileGroup, MobileSpace } from "./api";
import { selectSpace } from "./api";
import { mobileLogoAvatarActivity } from "./logo-avatar-activity";
import type { InboxSignal } from "./offscreen-unreads";

export type InboxSpace = Pick<MobileSpace, "id" | "name" | "isDefault" | "hasContent"> & {
  bots: (MobileBot | SpaceBot)[];
  groups: (MobileGroup | SpaceGroup)[];
};

export type InboxItem =
  | { type: "bot"; bot: MobileBot | SpaceBot }
  | { type: "group"; group: MobileGroup | SpaceGroup }
  | { type: "heading"; key: string; title: string; space: InboxSpace };

export function inboxItemKey(item: InboxItem): string {
  if (item.type === "heading") return `heading-${item.key}`;
  if (item.type === "bot") return item.bot.id;
  return `group-${item.group.id}`;
}

/** What a row adds to the off-screen unread pills: unread, and a bot waiting on you. */
export function inboxSignal(item: InboxItem): InboxSignal {
  if (item.type === "heading") return { unread: 0, attention: 0 };
  if (item.type === "group") return { unread: item.group.unread ? 1 : 0, attention: 0 };
  const { bot } = item;
  return {
    unread: bot.unread ? 1 : 0,
    attention: logoAvatarNeedsAttention(
      botAvatarActivity(bot, mobileLogoAvatarActivity.getActivity(bot.id, bot.status)),
    )
      ? 1
      : 0,
  };
}

/** Only space headings, with no chats under them. */
export function inboxHasNoChats(items: readonly { type: string }[]): boolean {
  return items.every((item) => item.type === "heading");
}

export function spaceInboxItems(spaces: InboxSpace[]): InboxItem[] {
  return spaces.flatMap((space): InboxItem[] => {
    const items: InboxItem[] = [];
    if (
      spaces.length > 1 ||
      !space.isDefault ||
      (space.bots.length === 0 && space.groups.length === 0)
    ) {
      items.push({ type: "heading", key: space.id, title: space.name, space });
    }
    for (const bot of space.bots) items.push({ type: "bot", bot });
    for (const group of space.groups) items.push({ type: "group", group });
    return items;
  });
}

export async function selectInboxSpace(spaceId: string, refresh: () => Promise<void>) {
  if (!(await selectSpace(spaceId).catch(() => false))) return false;
  await refresh();
  return true;
}
