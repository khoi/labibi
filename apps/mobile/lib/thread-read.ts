import type { ReadBoundary } from "@labradoodle/core";
import { createChatQueues, settleReadBoundary } from "@labradoodle/core";
import { useNavigation } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, AppState } from "react-native";
import type { MobileMessage } from "./api";
import { rpc } from "./api";
import { useI18n } from "./i18n";
import { dismissThreadNotifications } from "./live-notifications";
import { errorText } from "./user-error";

/**
 * Read state for one open chat: each open or return is a visit, the chat is marked read while it
 * is on screen, and "Mark as unread" holds it unread for the rest of that visit.
 */
export function useThreadRead({
  threadId,
  focused,
  readOnly,
}: {
  threadId?: string;
  focused: boolean;
  readOnly: boolean;
}) {
  const { t } = useI18n();
  const navigation = useNavigation();
  const readVisibleTarget = useRef<string | null>(null);
  // What the user had read up to when this chat opened; the "New" divider follows it all visit.
  // Each open or return to a chat is a new visit.
  const readVisit = useRef<{ target: string | undefined; visit: number; focused: boolean }>({
    target: undefined,
    visit: 0,
    focused,
  });
  const [readBoundary, setReadBoundary] = useState<ReadBoundary | null>(null);
  // A chat's markRead calls run one at a time so the request that opened it answers first.
  const [readInOrder] = useState(createChatQueues);
  const threadKey = threadId;
  if (readVisit.current.target !== threadKey || (focused && !readVisit.current.focused)) {
    readVisit.current = { target: threadKey, visit: readVisit.current.visit + 1, focused };
    readVisibleTarget.current = null;
  }
  readVisit.current.focused = focused;

  // After "Mark as unread" on a message, the chat stays unread for the rest of this visit. The
  // hold names the visit, so returning to the chat (a new visit) reads it again.
  const heldUnread = useRef<number | null>(null);
  const [markedUnread, setMarkedUnread] = useState<{ visit: number; messageId: string } | null>(
    null,
  );
  const markedUnreadMessageId =
    markedUnread?.visit === readVisit.current.visit ? markedUnread.messageId : undefined;
  const markUnreadFrom = (message: MobileMessage) => {
    const visit = readVisit.current.visit;
    const target = threadId;
    if (!target) return;
    heldUnread.current = visit;
    // Through the chat's read queue, so a read already sent lands first and this one wins.
    void readInOrder(target, () =>
      rpc("threads/markUnread", { threadId: target, messageId: message.id }),
    )
      .then(() => {
        if (readVisit.current.visit === visit) {
          setMarkedUnread({ visit, messageId: message.id });
        }
      })
      .catch((err) => {
        if (heldUnread.current === visit) heldUnread.current = null;
        Alert.alert(t("Could not update chat"), errorText(err, t("Try again.")));
      });
  };

  const markReadIfVisible = useCallback(() => {
    if (
      readOnly ||
      heldUnread.current === readVisit.current.visit ||
      AppState.currentState !== "active" ||
      !navigation.isFocused()
    )
      return;
    const target = threadId;
    if (!target || readVisibleTarget.current === target) return;
    readVisibleTarget.current = target;
    const visit = readVisit.current.visit;
    void dismissThreadNotifications({ threadId: target }).catch(() => undefined);
    // A read that waited in the queue skips once the user has left the chat, or marked it
    // unread meanwhile.
    void readInOrder(target, () =>
      readVisit.current.visit === visit &&
      heldUnread.current !== visit &&
      AppState.currentState === "active" &&
      navigation.isFocused()
        ? rpc("threads/markRead", { threadId: target })
        : Promise.resolve(null),
    )
      .then((answer) => {
        if (!answer) {
          if (readVisibleTarget.current === target) readVisibleTarget.current = null;
          return;
        }
        setReadBoundary((current) =>
          settleReadBoundary(current, readVisit.current.visit, {
            visit,
            seq: answer.unreadAfterSeq ?? null,
          }),
        );
      })
      .catch(() => {
        if (readVisibleTarget.current === target) readVisibleTarget.current = null;
      });
  }, [threadId, navigation, readInOrder, readOnly]);

  return {
    threadKey,
    readVisit,
    readVisibleTarget,
    readBoundary,
    setReadBoundary,
    markedUnreadMessageId,
    markUnreadFrom,
    markReadIfVisible,
  };
}
