import type { Bot, Group } from "@labradoodle/contracts";
import { lazyOverlay } from "../../components/ErrorBoundary";
import type { ShellDialogsState } from "./shell-dialogs";
import type { useChatRead } from "./use-chat-read";

const BotContextMenu = lazyOverlay(() =>
  import("../BotContextMenu").then((module) => module.BotContextMenu),
);

type ChatRead = ReturnType<typeof useChatRead>;

/** The right-click menu for a bot or group in the roster. */
export function ChatContextMenu({
  bot,
  group,
  onClose,
  read,
  dialogs,
  openChatSettings,
}: {
  bot: Bot | undefined;
  group: Group | undefined;
  onClose: () => void;
  read: Pick<ChatRead, "markBotRead" | "markBotUnread" | "toggleGroupUnread">;
  dialogs: ShellDialogsState;
  openChatSettings: (kind: "bot" | "group", id: string) => void;
}) {
  const chat = bot ?? group;
  if (!chat) return null;
  const target = bot
    ? { kind: "bot" as const, chat: bot }
    : { kind: "group" as const, chat: group! };
  return (
    <BotContextMenu
      bot={chat}
      onClose={onClose}
      onToggleUnread={() => {
        const unread = !chat.unread;
        onClose();
        if (bot) {
          const request = unread ? read.markBotUnread(bot.id) : read.markBotRead(bot.id);
          void request.catch(() => undefined);
        } else {
          read.toggleGroupUnread(group!.id, unread);
        }
      }}
      onEdit={() => {
        openChatSettings(bot ? "bot" : "group", chat.id);
        onClose();
      }}
      onClear={() => {
        dialogs.setClearTarget(target);
        onClose();
      }}
      onDelete={() => {
        if (bot) dialogs.setDeleteTarget(bot);
        else dialogs.setDeleteGroupTarget(group!);
        onClose();
      }}
    />
  );
}
