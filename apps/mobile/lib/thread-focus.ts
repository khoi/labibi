import { useFocusEffect, useNavigation } from "expo-router";
import type { RefObject } from "react";
import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import { selectedSpaceId } from "./api";
import { saveLastBotId } from "./last-bot";
import { dismissThreadNotifications, setOpenNotificationThread } from "./live-notifications";
import { useOpenNotificationThread } from "./use-open-notification-thread";

/**
 * What the chat does while it is in front: clears its notifications, remembers the bot, and
 * catches up on read state and spoken replies on return.
 */
export function useThreadFocus({
  botId,
  readOnly,
  notificationThreadId,
  refreshMentionBots,
  markReadIfVisible,
  speakFinishedReplyRef,
}: {
  botId?: string;
  readOnly: boolean;
  notificationThreadId?: string;
  refreshMentionBots: () => Promise<unknown>;
  markReadIfVisible: () => void;
  speakFinishedReplyRef: RefObject<() => void>;
}) {
  const navigation = useNavigation();

  useEffect(() => {
    if (!notificationThreadId || AppState.currentState !== "active" || !navigation.isFocused())
      return;
    void setOpenNotificationThread({ botId, threadId: notificationThreadId }).catch(
      () => undefined,
    );
    void dismissThreadNotifications({ threadId: notificationThreadId }).catch(() => undefined);
  }, [botId, navigation, notificationThreadId]);

  // Covers returning from a pushed screen; the AppState listener covers returning from background.
  useFocusEffect(
    useCallback(() => {
      if (botId && !readOnly) void saveLastBotId(botId, selectedSpaceId()).catch(() => undefined);
      void refreshMentionBots();
      markReadIfVisible();
      if (!readOnly) speakFinishedReplyRef.current();
    }, [botId, readOnly, markReadIfVisible, refreshMentionBots]),
  );

  useOpenNotificationThread({
    botId,
    threadId: notificationThreadId,
    navigation,
    markReadIfVisible,
  });
}
