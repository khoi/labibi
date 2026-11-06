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
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  SquarePen,
  UserPlus,
} from "lucide-react";
import type { ReactNode } from "react";
import { IconTooltip } from "../../components/IconTooltip";
import { desktopBridge } from "../../lib/desktop";
import { WindowChrome } from "../WindowChrome";

export function SidebarHeader({
  mini = false,
  searchOpen = false,
  workspace,
  onSearch,
  onNewChat,
  setSidebarCollapsedPref,
}: {
  mini?: boolean;
  workspace?: ReactNode;
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
      {hasWindowChrome || (!mini && !workspace) ? <WindowChrome /> : null}
      {mini ? null : workspace}
      <div className={`relative flex shrink-0 items-center ${mini ? "flex-col gap-0.5" : "gap-1"}`}>
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
  if (!current) return null;
  const switchable = workspaces.length > 1;
  const otherUnread = workspaces.some(
    (workspace) => workspace.id !== currentId && workspace.unread,
  );
  return (
    <div className="flex min-w-0 flex-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              data-testid="workspace-switcher"
              className="app-no-drag -ms-2 min-w-0 max-w-full justify-start gap-1 px-2 text-body2 font-medium"
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
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[220px]">
          {switchable ? (
            <>
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
            </>
          ) : null}
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
