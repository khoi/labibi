import { useFocusEffect } from "expo-router";
import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import { setOpenNotificationThread } from "./live-notifications";

/**
 * Tells the notification poller which thread is open while it is focused and the app is in the
 * foreground, and marks it read on return from the background.
 */
export function useOpenNotificationThread({
  threadId,
  navigation,
  markReadIfVisible,
}: {
  threadId?: string;
  navigation: { isFocused(): boolean };
  markReadIfVisible: () => void;
}) {
  // Kept apart from the screen's other focus work: its callbacks change with every streamed
  // message, and each re-run would close and reopen the thread, restarting the Android
  // notification poller.
  useFocusEffect(
    useCallback(() => {
      if (AppState.currentState === "active" && threadId) {
        void setOpenNotificationThread({ threadId }).catch(() => undefined);
      }
      return () => {
        void setOpenNotificationThread(null).catch(() => undefined);
      };
    }, [threadId]),
  );

  useEffect(() => {
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (!navigation.isFocused() || !threadId) return;
        void setOpenNotificationThread({ threadId }).catch(() => undefined);
        markReadIfVisible();
        return;
      }
      void setOpenNotificationThread(null).catch(() => undefined);
    });
    return () => appState.remove();
  }, [markReadIfVisible, navigation, threadId]);
}
