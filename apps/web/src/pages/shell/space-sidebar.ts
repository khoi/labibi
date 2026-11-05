type SidebarChat = {
  id: string;
  name: string;
  preview?: string | null;
};

type SidebarSpace<TBot extends SidebarChat, TGroup extends SidebarChat> = {
  id: string;
  name: string;
  canRename?: boolean;
  canDelete?: boolean;
  shared?: boolean;
  bots: readonly TBot[];
  groups: readonly TGroup[];
};

function spaceHeaderMenu(space: { canRename?: boolean; canDelete?: boolean }, hostsMenu: boolean) {
  return {
    canRenameSpace: hostsMenu && space.canRename === true,
    canDeleteSpace: hostsMenu && space.canDelete === true,
    // Every member can open a space's settings, so the menu does not depend on rename or delete.
    canOpenSpaceSettings: hostsMenu,
  };
}

export async function commitSpaceRename(input: {
  rename: () => Promise<void>;
  apply: () => void;
  refresh: () => Promise<void>;
}): Promise<void> {
  await input.rename();
  input.apply();
  await input.refresh().catch(() => undefined);
}

export function sidebarGroupsForSpaces<TBot extends SidebarChat, TGroup extends SidebarChat>(
  spaces: readonly SidebarSpace<TBot, TGroup>[],
  query: string,
) {
  const needle = query.toLowerCase();
  const matches = (chat: SidebarChat) =>
    `${chat.name} ${chat.preview ?? ""}`.toLowerCase().includes(needle);
  const showSpaceNames = spaces.length > 1;
  return spaces.flatMap((space) => {
    const chats = [
      ...space.bots.filter(matches).map((chat) => ({ kind: "bot" as const, id: chat.id, chat })),
      ...space.groups
        .filter(matches)
        .map((chat) => ({ kind: "group" as const, id: chat.id, chat })),
    ];
    const header = {
      showLock: showSpaceNames,
      shared: space.shared === true,
      spaceId: space.id,
      spaceName: space.name,
      title: space.name,
      ...spaceHeaderMenu(space, true),
    };
    if (chats.length > 0)
      return [
        {
          ...header,
          key: showSpaceNames ? `space:${space.id}:chats` : "chats",
          bots: chats,
          emptySpaceId: undefined as string | undefined,
        },
      ];
    // Keep empty spaces selectable; chat clicks are the only switch control.
    if (needle && (space.bots.length > 0 || space.groups.length > 0)) return [];
    // A lone space is the selected one, so its settings stay in the account menu too.
    const lone = !showSpaceNames && !space.canRename && !space.canDelete;
    if (lone && needle) return [];
    return [
      {
        ...header,
        key: showSpaceNames ? `space:${space.id}:empty` : `space:${space.id}:actions`,
        bots: [] as typeof chats,
        emptySpaceId: showSpaceNames ? space.id : undefined,
      },
    ];
  });
}

/** Count the unread flags the roster renders. Pass unfiltered groups for the app badge. */
export function countUnreadChats(
  sections: readonly { bots: readonly { chat: { unread?: boolean } }[] }[],
): number {
  return sections.reduce(
    (count, section) => count + section.bots.filter((item) => item.chat.unread).length,
    0,
  );
}
