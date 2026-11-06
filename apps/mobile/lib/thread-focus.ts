import { useFocusEffect, useNavigation } from "expo-router";
import type { RefObject } from "react";
import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import { selectedSpaceId } from "./api";
import { saveLastChatId } from "./last-chat";
import { dismissThreadNotifications, setOpenNotificationThread } from "./live-notifications";
import { useOpenNotificationThread } from "./use-open-notification-thread";

/**
 * What the chat does while it is in front: clears its notifications, remembers the chat, and
 * catches up on read state and spoken replies on return.
 */
export function useThreadFocus({
  threadId,
  markReadIfVisible,
  speakFinishedReplyRef,
}: {
  threadId?: string;
  markReadIfVisible: () => void;
  speakFinishedReplyRef: RefObject<() => void>;
}) {
  const navigation = useNavigation();

  useEffect(() => {
    if (!threadId || AppState.currentState !== "active" || !navigation.isFocused()) return;
    void setOpenNotificationThread({ threadId }).catch(() => undefined);
    void dismissThreadNotifications({ threadId }).catch(() => undefined);
  }, [navigation, threadId]);

  // Covers returning from a pushed screen; the AppState listener covers returning from background.
  useFocusEffect(
    useCallback(() => {
      if (threadId) void saveLastChatId(threadId, selectedSpaceId()).catch(() => undefined);
      markReadIfVisible();
      speakFinishedReplyRef.current();
    }, [threadId, markReadIfVisible]),
  );

  useOpenNotificationThread({
    threadId,
    navigation,
    markReadIfVisible,
  });
}
