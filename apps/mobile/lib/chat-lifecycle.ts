import { Alert } from "react-native";
import { rpc } from "./api";
import { notifyConversationCleared } from "./conversation-cleared";
import { t } from "./i18n";
import { forgetSavedThread } from "./saved-chats";
import { removeFromSearchInbox } from "./search-inbox";
import { errorText } from "./user-error";

/**
 * Leaving takes the chat off your list; deleting (only a chat with no one else in it) removes it
 * for good. Both ask first, with the destructive choice as the native alert's red button.
 */
export function confirmEndChat(
  chat: { id: string; title: string },
  action: "leave" | "delete",
  onDone: () => void,
) {
  const label = action === "leave" ? t("Leave chat") : t("Delete chat");
  Alert.alert(label, chat.title || undefined, [
    { text: t("Cancel"), style: "cancel" },
    {
      text: label,
      style: "destructive",
      onPress: () =>
        void rpc(action === "leave" ? "threads/leave" : "threads/delete", { threadId: chat.id })
          .then(() => {
            removeFromSearchInbox(chat.id);
            forgetSavedThread(chat.id);
            onDone();
          })
          .catch((error: unknown) =>
            Alert.alert(t("Could not update chat"), errorText(error, t("Try again."))),
          ),
    },
  ]);
}

/** Only a chat with no one else in it can be cleared. */
export function confirmClearConversation(threadId: string, onCleared?: () => void) {
  Alert.alert(t("Clear conversation"), undefined, [
    { text: t("Cancel"), style: "cancel" },
    {
      text: t("Clear conversation"),
      style: "destructive",
      onPress: () =>
        void rpc("threads/clear", { threadId })
          .then(() => {
            notifyConversationCleared(threadId);
            onCleared?.();
          })
          .catch((error: unknown) =>
            Alert.alert(t("Could not clear conversation"), errorText(error, t("Try again."))),
          ),
    },
  ]);
}
