import type { SpaceBot, SpaceGroup } from "@labradoodle/contracts";
import { botAvatarActivity, logoAvatarNeedsAttention } from "@labradoodle/core";
import type { MobileBot, MobileGroup, MobileSpace } from "./api";
import { adoptDeletedSpaceFallback, rpc, selectedSpaceId, selectSpace } from "./api";
import { t } from "./i18n";
import { mobileLogoAvatarActivity } from "./logo-avatar-activity";
import type { InboxSignal } from "./offscreen-unreads";

export type InboxSpace = Pick<
  MobileSpace,
  "id" | "name" | "isDefault" | "hasContent" | "canDelete" | "botCount"
> & {
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

export function canDeleteInboxSpace(space: Pick<InboxSpace, "isDefault" | "canDelete">) {
  return !space.isDefault && space.canDelete === true;
}

/** Names every bot that goes with the space, archived and other members' included. */
export function deleteSpaceTitle(space: Pick<InboxSpace, "name" | "botCount" | "bots">) {
  // Servers before botCount only listed the member's active bots.
  const bots = space.botCount ?? space.bots.length;
  if (bots === 0) return t("Delete {name}?", { name: space.name });
  if (bots === 1) return t("Delete {name} and its bot?", { name: space.name });
  return t("Delete {name} and its {count} bots?", { name: space.name, count: bots });
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

export async function retryInboxSpaceFallback(spaceId: string, refresh: () => Promise<void>) {
  if (!(await adoptDeletedSpaceFallback(spaceId))) return false;
  await refresh();
  return true;
}

// Return the selection to retry if native storage fails after a successful deletion.
// The inbox must not refresh against the deleted selection in that case.
export async function removeInboxSpace(
  spaceId: string,
  refresh: () => Promise<void>,
): Promise<string | null> {
  const response = await rpc("spaces/remove", { spaceId });
  if (selectedSpaceId() === spaceId) {
    if (await selectSpace(response.activeSpaceId).catch(() => false)) {
      await refresh();
      return null;
    }
    const durable = await adoptDeletedSpaceFallback(response.activeSpaceId);
    await refresh();
    return durable ? null : response.activeSpaceId;
  }
  await refresh();
  return null;
}
