import type { Dispatch, SetStateAction } from "react";
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import type { MobileChat } from "./api";
import { currentApiBase, loadSessionToken, rpc, selectedSpaceId } from "./api";
import { confirmEndChat } from "./chat-lifecycle";
import { useI18n } from "./i18n";
import type { InboxRowAction } from "./inbox-swipe";
import { createLatestQueue } from "./inbox-swipe";
import { afterChatNotifyChange, dismissThreadNotifications } from "./live-notifications";
import { currentSessionGeneration } from "./session";
import { errorText } from "./user-error";

/** Row actions on inbox chats: read state, notifications, and leaving or deleting. */
export function useInboxChatActions({
  loadChats,
  setChats,
}: {
  loadChats: () => Promise<unknown>;
  setChats: Dispatch<SetStateAction<MobileChat[]>>;
}) {
  const { t } = useI18n();
  const [unreadOverrides, setUnreadOverrides] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  // One path for the long-press menu and the swipe actions.
  const [sendReadState] = useState(() => createLatestQueue<boolean>());

  const setMuted = useCallback(
    async (chat: MobileChat, muted: boolean) => {
      await rpc("threads/setMuted", { threadId: chat.id, muted });
      setChats((chats) => chats.map((item) => (item.id === chat.id ? { ...item, muted } : item)));
      await afterChatNotifyChange(
        currentApiBase(),
        await loadSessionToken(),
        selectedSpaceId() ?? "",
        { threadId: chat.id, notify: !muted },
      );
    },
    [setChats],
  );

  const setRead = useCallback(
    (chat: MobileChat, unread: boolean) => {
      const session = currentSessionGeneration();
      setUnreadOverrides((current) => new Map(current).set(chat.id, unread));
      if (!unread) void dismissThreadNotifications({ threadId: chat.id }).catch(() => undefined);
      void sendReadState(
        chat.id,
        unread,
        async (next) => {
          if (session !== currentSessionGeneration()) return;
          await rpc(next ? "threads/markUnread" : "threads/markRead", { threadId: chat.id });
          setChats((chats) =>
            chats.map((item) => (item.id === chat.id ? { ...item, unread: next } : item)),
          );
          await loadChats();
        },
        // The override stays until the last queued change for this chat is done.
        () =>
          setUnreadOverrides((current) => {
            const next = new Map(current);
            next.delete(chat.id);
            return next;
          }),
      ).catch((err) => {
        // A change from a session that has since ended is dropped quietly.
        if (session !== currentSessionGeneration()) return;
        Alert.alert(t("Could not update chat"), errorText(err, t("Try again.")));
      });
    },
    [loadChats, sendReadState, setChats, t],
  );

  const chatAction = useCallback(
    (action: InboxRowAction, chat: MobileChat) => {
      if (action === "read" || action === "unread") setRead(chat, action === "unread");
      else if (action === "mute" || action === "unmute")
        void setMuted(chat, action === "mute").catch((err) =>
          Alert.alert(t("Could not update chat"), errorText(err, t("Try again."))),
        );
      else confirmEndChat(chat, action, () => void loadChats());
    },
    [loadChats, setMuted, setRead, t],
  );

  return { unreadOverrides, chatAction };
}
