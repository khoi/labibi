import type { Bot } from "@labradoodle/contracts";
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "@labradoodle/ui-web";
import { useLingui } from "@lingui/react/macro";
import { Bell, BellDot, Eraser, Pencil, Trash2 } from "lucide-react";

type ChatMenuTarget = Pick<Bot, "name" | "unread">;

/** A roster row's context menu content; `onClose` serves the lazy-load error fallback. */
export function BotContextMenu({
  bot,
  onToggleUnread,
  onEdit,
  onClear,
  onDelete,
}: {
  bot: ChatMenuTarget;
  onClose: () => void;
  onToggleUnread: () => void;
  onEdit: () => void;
  onClear: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();

  return (
    <ContextMenuContent
      aria-label={t`Actions for ${bot.name}`}
      className="max-h-[min(420px,calc(100vh-16px))] w-[264px] overflow-y-auto"
    >
      <ContextMenuItem onClick={onToggleUnread}>
        {bot.unread ? <BellDot /> : <Bell />}
        {bot.unread ? t`Mark as Read` : t`Mark as Unread`}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onEdit}>
        <Pencil />
        {t`Edit Profile`}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onClear}>
        <Eraser />
        {t`Clear conversation`}
      </ContextMenuItem>
      <ContextMenuItem variant="destructive" onClick={onDelete}>
        <Trash2 />
        {t`Delete`}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
