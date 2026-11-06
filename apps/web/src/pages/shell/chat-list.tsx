import type { Chat } from "@labradoodle/contracts";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@labradoodle/ui-web";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Bell, BellDot, LogOut, Trash2 } from "lucide-react";
import { IconTooltip } from "../../components/IconTooltip";
import type { BotsSidebarDensity } from "../../lib/bots-sidebar-density-pref";
import { ChatAvatar } from "./chat-avatar";
import { useRedrawAtMidnight } from "./use-redraw-at-midnight";

/** What a chat is called in lists and headers. */
export function chatLabel(chat: Pick<Chat, "title">) {
  return chat.title || t`New chat`;
}

/** Whether nobody but the viewer is in the chat, so it is deleted rather than left. */
export function soloChat(chat: Pick<Chat, "members">, userId: string | undefined) {
  return chat.members.every((member) => member.userId === userId);
}

/** The workspace's chats, most recent activity first; unread ones are bold. */
export function ChatList({
  chats,
  activeId,
  userId,
  density,
  mini = false,
  onOpen,
  onToggleUnread,
  onLeave,
}: {
  chats: readonly Chat[];
  activeId: string | undefined;
  userId: string | undefined;
  density: BotsSidebarDensity;
  mini?: boolean;
  onOpen: (chat: Chat) => void;
  onToggleUnread: (chat: Chat) => void;
  onLeave: (chat: Chat) => void;
}) {
  useRedrawAtMidnight();
  const { t } = useLingui();
  const compact = density === "compact";
  return (
    <div className="flex flex-col gap-0.5" data-testid="chat-list">
      {chats.map((chat) => {
        const selected = chat.id === activeId;
        const label = chatLabel(chat);
        const avatar = (
          <ChatAvatar chat={chat} userId={userId} size={mini ? 40 : compact ? 28 : 38} />
        );
        const trigger = (
          <ContextMenuTrigger
            render={<button type="button" />}
            data-chat-id={chat.id}
            data-chat-unread={chat.unread ? "true" : undefined}
            aria-current={selected ? "page" : undefined}
            aria-label={mini ? label : undefined}
            onClick={() => onOpen(chat)}
            // Focus the row so closing the menu returns focus here.
            onContextMenu={(event) => event.currentTarget.focus()}
            className={`flex items-center ${
              mini
                ? "mx-auto size-12 justify-center rounded-xl"
                : compact
                  ? "w-full min-h-11 gap-2 rounded-xl px-2.5 py-1.5"
                  : "w-full gap-3 rounded-xl px-2.5 py-[10px]"
            } text-start ${selected ? "bg-sidebar-accent" : "hover:bg-accent"}`}
          >
            {mini ? (
              <span className="relative shrink-0">
                {avatar}
                {chat.unread ? (
                  <span
                    aria-hidden="true"
                    className="absolute -end-0.5 top-0 size-2 rounded-full bg-unread ring-2 ring-sidebar"
                  />
                ) : null}
              </span>
            ) : (
              avatar
            )}
            {!mini ? (
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1.5">
                  <span
                    dir="auto"
                    data-chat-title=""
                    className={`min-w-0 truncate text-body2 text-foreground ${
                      chat.unread ? "font-semibold" : "font-medium"
                    }`}
                  >
                    {label}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!compact ? (
                      <span className="text-label text-faint-foreground tabular-nums">
                        {formatChatTime(chat.lastMessageAt)}
                      </span>
                    ) : null}
                    {chat.unread ? (
                      <span
                        aria-hidden="true"
                        className="inline-block h-2 w-2 rounded-full bg-unread"
                      />
                    ) : null}
                  </div>
                </div>
                {!compact && chat.preview ? (
                  <div
                    dir="auto"
                    className={`mt-1 truncate text-label ${
                      chat.unread ? "font-medium text-foreground/75" : "text-muted-foreground"
                    }`}
                  >
                    {chat.preview}
                  </div>
                ) : null}
                {chat.unread ? (
                  <span className="sr-only">
                    <Trans> (unread)</Trans>
                  </span>
                ) : null}
              </div>
            ) : null}
          </ContextMenuTrigger>
        );
        const solo = soloChat(chat, userId);
        return (
          <ContextMenu key={chat.id}>
            {mini ? (
              <IconTooltip side="inline-end" label={label}>
                {trigger}
              </IconTooltip>
            ) : (
              trigger
            )}
            <ContextMenuContent aria-label={t`Actions for ${label}`} className="w-[220px]">
              <ContextMenuItem onClick={() => onToggleUnread(chat)}>
                {chat.unread ? <BellDot /> : <Bell />}
                {chat.unread ? t`Mark as Read` : t`Mark as Unread`}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onClick={() => onLeave(chat)}>
                {solo ? <Trash2 /> : <LogOut />}
                {solo ? t`Delete chat` : t`Leave chat`}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </div>
  );
}

function formatChatTime(isoDate?: string | null): string {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "";
  const locale = i18n.locale || "en";
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear();
  if (sameDay(d, now)) return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return t`Yesterday`;
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) return d.toLocaleDateString(locale, { weekday: "short" });
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}
