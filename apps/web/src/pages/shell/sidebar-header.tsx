import type { Workspace } from "@labradoodle/contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@labradoodle/ui-web";
import { useLingui } from "@lingui/react/macro";
import {
  Check,
  ChevronsUpDown,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  SquarePen,
  UserPlus,
} from "lucide-react";
import { IconTooltip } from "../../components/IconTooltip";
import { desktopBridge } from "../../lib/desktop";
import { WindowChrome } from "../WindowChrome";

export function SidebarHeader({
  mini = false,
  searchOpen = false,
  onSearch,
  onNewChat,
  setSidebarCollapsedPref,
}: {
  mini?: boolean;
  searchOpen?: boolean;
  onSearch?: () => void;
  onNewChat: () => void;
  setSidebarCollapsedPref: (collapsed: boolean) => void;
}) {
  const { t } = useLingui();
  const hasWindowChrome = Boolean(desktopBridge());
  const toggleLabel = mini ? t`Show chats` : t`Minimize chats`;
  return (
    <div
      className={`app-drag flex items-center ${mini ? `flex-col gap-2 px-0 pb-2 ${hasWindowChrome ? "pt-4" : "pt-2"}` : "justify-between px-[18px] pb-3 pt-4"}`}
    >
      {!mini || hasWindowChrome ? <WindowChrome /> : null}
      <div className={`relative flex items-center ${mini ? "flex-col gap-0.5" : "gap-1"}`}>
        {onSearch ? (
          <IconTooltip label={t`Search`}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Search`}
              aria-pressed={searchOpen}
              data-testid="sidebar-search-trigger"
              onClick={onSearch}
              className="app-no-drag text-muted-foreground"
            >
              <Search size={15} strokeWidth={1.8} aria-hidden="true" />
            </Button>
          </IconTooltip>
        ) : null}
        <IconTooltip label={toggleLabel}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="app-no-drag hidden text-muted-foreground md:inline-flex"
            aria-label={toggleLabel}
            data-testid={mini ? "restore-bots-sidebar" : "minimize-bots-sidebar"}
            onClick={() => setSidebarCollapsedPref(!mini)}
          >
            {mini ? (
              <PanelLeftOpen size={15} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={15} strokeWidth={1.8} aria-hidden="true" />
            )}
          </Button>
        </IconTooltip>
        <IconTooltip label={t`New chat`}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="app-no-drag text-muted-foreground"
            aria-label={t`New chat`}
            data-testid="new-chat-trigger"
            onClick={onNewChat}
          >
            <SquarePen size={15} strokeWidth={1.8} aria-hidden="true" />
          </Button>
        </IconTooltip>
      </div>
    </div>
  );
}

/** Switches between the person's workspaces; shown only once they are in more than one. */
export function WorkspaceSwitcher({
  workspaces,
  currentId,
  onSelect,
  onInvite,
  onSettings,
}: {
  workspaces: readonly Workspace[];
  currentId: string | undefined;
  onSelect: (workspace: Workspace) => void;
  onInvite: () => void;
  onSettings: () => void;
}) {
  const { t } = useLingui();
  const current = workspaces.find((workspace) => workspace.id === currentId);
  if (workspaces.length < 2 || !current) return null;
  const otherUnread = workspaces.some(
    (workspace) => workspace.id !== currentId && workspace.unread,
  );
  return (
    <div className="px-2.5 pb-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              data-testid="workspace-switcher"
              className="w-full justify-between gap-2 px-2.5 text-body2 font-medium"
            />
          }
        >
          <span className="min-w-0 truncate" dir="auto">
            {current.name}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {otherUnread ? (
              <span aria-hidden="true" className="size-2 rounded-full bg-unread" />
            ) : null}
            <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden="true" />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-(--anchor-width) min-w-[220px]">
          {workspaces.map((workspace) => (
            <DropdownMenuItem key={workspace.id} onClick={() => onSelect(workspace)}>
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {workspace.name}
              </span>
              {workspace.id === currentId ? (
                <Check aria-hidden="true" />
              ) : workspace.unread ? (
                <span aria-hidden="true" className="size-2 rounded-full bg-unread" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {current.isOwner ? (
            <DropdownMenuItem onClick={onInvite}>
              <UserPlus />
              {t`Invite people`}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={onSettings}>
            <Settings />
            {t`Workspace settings`}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
