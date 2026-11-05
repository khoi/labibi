import type { Bot, Group, Space } from "@labradoodle/contracts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@labradoodle/ui-web";
import { useLingui } from "@lingui/react/macro";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Settings, Trash2 } from "lucide-react";
import type { ComponentProps, RefObject } from "react";
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { PAGE_PARAM } from "../../lib/pages";
import { useSpaceQueries } from "../../lib/query";
import type { Panel } from "../../lib/right-panel-state";
import type { createSpaceRpc } from "../../lib/rpc";
import { selectSpace } from "../../lib/rpc";
import type { CommandPaletteAction } from "./command-palette";
import { CommandPalette } from "./command-palette";
import {
  ClearConversationDialog,
  DeleteBotDialog,
  DeleteItemDialog,
  DeleteSpaceDialog,
  NewSpaceDialog,
} from "./dialogs";

type ChatTarget = { kind: "bot"; chat: Bot } | { kind: "group"; chat: Group };

/** Which of the shell's dialogs and menus are open, and on what. */
export function useShellDialogs() {
  const [deleteTarget, setDeleteTarget] = useState<Bot | null>(null);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<Group | null>(null);
  const [deleteSpaceTarget, setDeleteSpaceTarget] = useState<Space | null>(null);
  const [spaceMenu, setSpaceMenu] = useState<{
    id: string;
    position: { x: number; y: number };
  } | null>(null);
  const spaceMenuAnchor = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (spaceMenu || !spaceMenuAnchor.current) return;
    spaceMenuAnchor.current.focus();
    spaceMenuAnchor.current = null;
  }, [spaceMenu]);
  const closeSpaceMenu = useCallback(() => setSpaceMenu(null), []);
  const [clearTarget, setClearTarget] = useState<ChatTarget | null>(null);
  const [newSpaceOpen, setNewSpaceOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  return {
    deleteTarget,
    setDeleteTarget,
    deleteGroupTarget,
    setDeleteGroupTarget,
    deleteSpaceTarget,
    setDeleteSpaceTarget,
    spaceMenu,
    setSpaceMenu,
    spaceMenuAnchor,
    closeSpaceMenu,
    clearTarget,
    setClearTarget,
    newSpaceOpen,
    setNewSpaceOpen,
    commandPaletteOpen,
    setCommandPaletteOpen,
  };
}

export type ShellDialogsState = ReturnType<typeof useShellDialogs>;

/** The shell's confirmation dialogs, the space menu, and the command palette. */
export function ShellDialogs({
  dialogs,
  rpc,
  spaces,
  bots,
  activeId,
  activeGroupId,
  alive,
  navigate,
  setPanel,
  refreshBots,
  removeSpace,
  openSpaceSettings,
  closeMobileSidebar,
  clearOpenThread,
  discardChatAttachments,
  deleteRoutineDialogProps,
  paletteActions,
}: {
  dialogs: ShellDialogsState;
  rpc: ReturnType<typeof createSpaceRpc>;
  spaces: Space[];
  bots: Bot[];
  activeId: string | undefined;
  activeGroupId: string | undefined;
  alive: RefObject<boolean>;
  navigate: (path: string) => void;
  setPanel: (panel: Panel) => void;
  refreshBots: (mayBeEmpty?: boolean) => Promise<void>;
  removeSpace: (spaceId: string) => Promise<void>;
  openSpaceSettings: (spaceId: string) => void;
  closeMobileSidebar: () => void;
  clearOpenThread: () => void;
  /** Drops a deleted chat's pending attachments with their previews. */
  discardChatAttachments: (threadKey: string) => void;
  deleteRoutineDialogProps: ComponentProps<typeof DeleteItemDialog> | null;
  paletteActions: CommandPaletteAction[];
}) {
  const { t } = useLingui();
  const {
    deleteTarget,
    setDeleteTarget,
    deleteGroupTarget,
    setDeleteGroupTarget,
    deleteSpaceTarget,
    setDeleteSpaceTarget,
    spaceMenu,
    setSpaceMenu,
    closeSpaceMenu,
    clearTarget,
    setClearTarget,
    newSpaceOpen,
    setNewSpaceOpen,
    commandPaletteOpen,
    setCommandPaletteOpen,
  } = dialogs;
  const spaceMenuTarget = spaceMenu
    ? (spaces.find((space) => space.id === spaceMenu.id) ?? null)
    : null;
  const queries = useSpaceQueries();
  const [pageSearch, setPageSearch] = useState("");
  const pageQuery = useDeferredValue(pageSearch.trim());
  const pages = useQuery({
    ...queries.pages.list.queryOptions({ input: pageQuery ? { query: pageQuery } : {} }),
    enabled: commandPaletteOpen,
    placeholderData: keepPreviousData,
  });
  return (
    <>
      {spaceMenu ? (
        <DropdownMenu
          open
          onOpenChange={(open) => {
            if (!open) closeSpaceMenu();
          }}
        >
          {/* Invisible anchor at the pointer position, mirroring the bot menu. */}
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                tabIndex={-1}
                aria-hidden
                className="fixed size-0 p-0 opacity-0"
                style={{ left: spaceMenu.position.x, top: spaceMenu.position.y }}
              />
            }
          />
          <DropdownMenuContent
            aria-label={t`Actions for space`}
            align="start"
            sideOffset={0}
            className="w-[220px]"
          >
            {spaceMenuTarget ? (
              <DropdownMenuItem
                onClick={() => {
                  setSpaceMenu(null);
                  openSpaceSettings(spaceMenuTarget.id);
                }}
              >
                <Settings />
                {t`Settings`}
              </DropdownMenuItem>
            ) : null}
            {spaceMenuTarget?.canDelete ? (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  setDeleteSpaceTarget(spaceMenuTarget);
                  setSpaceMenu(null);
                }}
              >
                <Trash2 />
                {t`Delete space`}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {deleteTarget ? (
        <DeleteBotDialog
          bot={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async (deleteMemories) => {
            await rpc.bots.remove({ botId: deleteTarget.id, deleteMemories });
            discardChatAttachments(deleteTarget.id);
            setDeleteTarget(null);
            setPanel(null);
            await refreshBots(true);
          }}
        />
      ) : null}

      {deleteGroupTarget ? (
        <DeleteItemDialog
          item={deleteGroupTarget}
          noun="group"
          onCancel={() => setDeleteGroupTarget(null)}
          onConfirm={async () => {
            await rpc.groups.remove({ groupId: deleteGroupTarget.id });
            discardChatAttachments(deleteGroupTarget.id);
            setDeleteGroupTarget(null);
            setPanel(null);
            await refreshBots(true);
          }}
        />
      ) : null}

      {deleteSpaceTarget ? (
        <DeleteSpaceDialog
          space={deleteSpaceTarget}
          onCancel={() => setDeleteSpaceTarget(null)}
          onConfirm={async () => {
            await removeSpace(deleteSpaceTarget.id);
            setDeleteSpaceTarget(null);
          }}
        />
      ) : null}

      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        bots={bots}
        onSelectBot={(id) => {
          closeMobileSidebar();
          navigate(`/app/${id}`);
        }}
        pages={pages.data?.items.filter((page) => page.groupId || page.botId)}
        onSearchChange={setPageSearch}
        onSelectPage={(page) => {
          closeMobileSidebar();
          const chat = page.groupId ? `/app/g/${page.groupId}` : `/app/${page.botId}`;
          navigate(`${chat}?${PAGE_PARAM}=${encodeURIComponent(page.id)}`);
        }}
        actions={paletteActions.map((action) => ({
          ...action,
          onSelect: () => {
            closeMobileSidebar();
            action.onSelect();
          },
        }))}
      />

      {newSpaceOpen ? (
        <NewSpaceDialog
          onCancel={() => setNewSpaceOpen(false)}
          onCreate={async (name) => (await rpc.spaces.create({ name })).id}
          loadItems={() => rpc.availability.items()}
          chooseItems={async (spaceId, items) => {
            await rpc.availability.chooseForSpace({
              spaceId,
              items: items.map(({ kind, id }) => ({ kind, id })),
            });
          }}
          onDone={(spaceId) => {
            if (!alive.current) return;
            if (!selectSpace(spaceId)) {
              setNewSpaceOpen(false);
              void refreshBots();
              return;
            }
            window.location.assign("/onboarding");
          }}
        />
      ) : null}

      {clearTarget ? (
        <ClearConversationDialog
          bot={clearTarget.chat}
          onCancel={() => setClearTarget(null)}
          onConfirm={async () => {
            await rpc.threads.clear(
              clearTarget.kind === "bot"
                ? { botId: clearTarget.chat.id }
                : { groupId: clearTarget.chat.id },
            );
            if (
              (clearTarget.kind === "bot" && activeId === clearTarget.chat.id) ||
              (clearTarget.kind === "group" && activeGroupId === clearTarget.chat.id)
            ) {
              clearOpenThread();
            }
            setClearTarget(null);
            await refreshBots();
          }}
        />
      ) : null}

      {deleteRoutineDialogProps ? <DeleteItemDialog {...deleteRoutineDialogProps} /> : null}
    </>
  );
}
