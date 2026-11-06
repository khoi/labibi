import { useNavigation, useRoute } from "expo-router";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { MobileChat } from "../../lib/api";
import { onConversationCleared } from "../../lib/conversation-cleared";
import { useI18n } from "../../lib/i18n";
import { threadEdgeOptions } from "../../lib/thread-edges";
import { publishChatTitle } from "../chat-header-title";

/**
 * The chat's navigation header: its title (which opens the chat's settings) and the split-view
 * inbox toggle.
 */
export function useThreadHeader({
  threadId,
  chat,
  viewerUserId,
  title,
  status,
  composing,
  onCleared,
}: {
  threadId?: string;
  /** The chat, or the inbox's copy of it until the chat's snapshot arrives. */
  chat?: MobileChat;
  viewerUserId: string;
  title: string;
  status?: string;
  composing: boolean;
  /** Runs once the server has cleared the conversation, from the chat's settings. */
  onCleared: () => void;
}) {
  const { t } = useI18n();
  const navigation = useNavigation();
  // This screen's own route: its header title reads what this screen publishes, by key.
  const route = useRoute();

  const cleared = useRef(onCleared);
  cleared.current = onCleared;
  useEffect(
    () =>
      onConversationCleared((clearedThreadId) => {
        if (clearedThreadId === threadId) cleared.current();
      }),
    [threadId],
  );

  // The route draws the title from the screen's first frame; the chat feeds it its own data.
  useLayoutEffect(
    () => publishChatTitle(route.key, { chat, viewerUserId, status, composing }),
    [route.key, chat, viewerUserId, status, composing],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: title || t("Chat"),
      headerTitleAlign: "center",
      ...threadEdgeOptions(),
    });
  }, [title, navigation, t]);
}
