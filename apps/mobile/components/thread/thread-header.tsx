import { useNavigation, useRoute } from "expo-router";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { MobileChat } from "../../lib/api";
import { mobileTokens } from "../../lib/appearance";
import { onConversationCleared } from "../../lib/conversation-cleared";
import { useI18n } from "../../lib/i18n";
import { useResolvedAppearance } from "../../lib/native";
import { useReferral } from "../../lib/referral";
import { threadEdgeOptions } from "../../lib/thread-edges";
import { publishChatTitle } from "../chat-header-title";
import { openInvite, threadHeaderRight } from "../thread-header-right";

/**
 * The chat's navigation header: its title (which opens the chat's settings), the invite gift in a
 * chat with only you, and the split-view inbox toggle.
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
  const colorScheme = useResolvedAppearance();
  const tokens = mobileTokens();
  const { t } = useI18n();
  const navigation = useNavigation();
  // This screen's own route: its header title reads what this screen publishes, by key.
  const route = useRoute();
  const canInvite = Boolean(useReferral());
  const solo = chat ? chat.members.every((member) => member.userId === viewerUserId) : false;

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
      ...threadHeaderRight({
        t,
        color: tokens.foreground,
        onInvite: canInvite && solo ? openInvite : undefined,
      }),
    });
  }, [canInvite, solo, title, navigation, t, tokens, colorScheme]);
}
