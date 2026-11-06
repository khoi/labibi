import { useCallback } from "react";
import { Platform } from "react-native";
import type { MobileChat } from "../lib/api";
import type { useInboxChatActions } from "../lib/use-inbox-chat-actions";
import { ChatRow } from "./inbox-rows";

// Swipe actions and the context menu are iOS list behaviour.
export const SWIPE_ROWS = Platform.OS === "ios";

/** The inbox list's row renderer. */
export function useInboxRenderItem({
  chatAction,
  day,
  viewerUserId,
  openChat,
}: Pick<ReturnType<typeof useInboxChatActions>, "chatAction"> & {
  day: number;
  viewerUserId: string | undefined;
  openChat: (chat: MobileChat) => void;
}) {
  return useCallback(
    ({ item }: { item: MobileChat }) => (
      <ChatRow
        chat={item}
        viewerUserId={viewerUserId}
        day={day}
        onPress={openChat}
        onAction={SWIPE_ROWS ? chatAction : undefined}
      />
    ),
    [chatAction, day, viewerUserId, openChat],
  );
}
