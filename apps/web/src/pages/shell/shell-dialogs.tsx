import type { Chat } from "@labradoodle/contracts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { useDeferredValue, useState } from "react";
import { chatPath } from "../../lib/bootstrap-target";
import { PAGE_PARAM } from "../../lib/pages";
import { useSpaceQueries } from "../../lib/query";
import type { createSpaceRpc } from "../../lib/rpc";
import { soloChat } from "./chat-list";
import type { CommandPaletteAction } from "./command-palette";
import { CommandPalette } from "./command-palette";
import { ClearConversationDialog, DeleteItemDialog } from "./dialogs";
import { LeaveChatDialog } from "./side-panel";

/** Which of the shell's dialogs are open, and on what. */
export function useShellDialogs() {
  const [leaveTarget, setLeaveTarget] = useState<Chat | null>(null);
  const [clearTarget, setClearTarget] = useState<Chat | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  return {
    leaveTarget,
    setLeaveTarget,
    clearTarget,
    setClearTarget,
    commandPaletteOpen,
    setCommandPaletteOpen,
  };
}

export type ShellDialogsState = ReturnType<typeof useShellDialogs>;

/** The shell's confirmation dialogs and the command palette. */
export function ShellDialogs({
  dialogs,
  rpc,
  chats,
  userId,
  activeId,
  navigate,
  onLeft,
  closeMobileSidebar,
  clearOpenThread,
  refreshChats,
  deleteRoutineDialogProps,
  paletteActions,
}: {
  dialogs: ShellDialogsState;
  rpc: ReturnType<typeof createSpaceRpc>;
  chats: readonly Chat[];
  userId: string | undefined;
  activeId: string | undefined;
  navigate: (path: string) => void;
  /** After the person left or deleted this chat. */
  onLeft: (chat: Chat) => void;
  closeMobileSidebar: () => void;
  clearOpenThread: () => void;
  refreshChats: () => Promise<void>;
  deleteRoutineDialogProps: ComponentProps<typeof DeleteItemDialog> | null;
  paletteActions: CommandPaletteAction[];
}) {
  const {
    leaveTarget,
    setLeaveTarget,
    clearTarget,
    setClearTarget,
    commandPaletteOpen,
    setCommandPaletteOpen,
  } = dialogs;
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
      {leaveTarget ? (
        <LeaveChatDialog
          chat={leaveTarget}
          solo={soloChat(leaveTarget, userId)}
          onCancel={() => setLeaveTarget(null)}
          onConfirm={async () => {
            const target = leaveTarget;
            if (soloChat(target, userId)) await rpc.threads.delete({ threadId: target.id });
            else await rpc.threads.leave({ threadId: target.id });
            setLeaveTarget(null);
            onLeft(target);
          }}
        />
      ) : null}

      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        bots={chats}
        userId={userId}
        onSelectBot={(id) => {
          closeMobileSidebar();
          navigate(chatPath(id));
        }}
        pages={pages.data?.items}
        onSearchChange={setPageSearch}
        onSelectPage={(page) => {
          closeMobileSidebar();
          navigate(`${chatPath(page.threadId)}?${PAGE_PARAM}=${encodeURIComponent(page.id)}`);
        }}
        actions={paletteActions.map((action) => ({
          ...action,
          onSelect: () => {
            closeMobileSidebar();
            action.onSelect();
          },
        }))}
      />

      {clearTarget ? (
        <ClearConversationDialog
          onCancel={() => setClearTarget(null)}
          onConfirm={async () => {
            await rpc.threads.clear({ threadId: clearTarget.id });
            if (activeId === clearTarget.id) clearOpenThread();
            setClearTarget(null);
            await refreshChats();
          }}
        />
      ) : null}

      {deleteRoutineDialogProps ? <DeleteItemDialog {...deleteRoutineDialogProps} /> : null}
    </>
  );
}
