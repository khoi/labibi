import { isRunWorking } from "@labradoodle/core";
import type { ReactNode } from "react";
import { createContext, memo, useContext } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import type { MobileChat } from "../lib/api";
import { AvatarRow } from "../lib/avatar-life";
import { useI18n } from "../lib/i18n";
import { formatThreadTime } from "../lib/inbox";
import type { InboxRowAction } from "../lib/inbox-swipe";
import { INBOX_ROW_ACTIONS, inboxReadAction, inboxRowActions } from "../lib/inbox-swipe";
import { useThemedStyles } from "../lib/native";
import { previewSnippet } from "../lib/preview";
import { androidRipple } from "../lib/ripple";
import { ChatAvatar } from "./chat-avatar";
import { createHomeStyles, INBOX_ROW } from "./home-styles";
import { InboxSwipeRow } from "./inbox-swipe-row";

export const CompactRowsContext = createContext(false);
// The chat open beside the list, so its row can show as selected.
export const SelectedChatContext = createContext<string | null>(null);

export function ConversationRow({
  chatId,
  title,
  preview,
  time,
  avatar,
  unread,
  onPress,
  onLongPress,
  actions = [],
  onAction,
  accessibilityLabel,
  accessibilityHint,
}: {
  chatId?: string;
  title: string;
  preview: string;
  time: string;
  avatar: ReactNode;
  unread?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  actions?: InboxRowAction[];
  onAction?: (action: InboxRowAction) => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
}) {
  const styles = useThemedStyles(createHomeStyles);
  const { t } = useI18n();
  const compact = useContext(CompactRowsContext);
  const openChatId = useContext(SelectedChatContext);
  const selected = chatId !== undefined && openChatId === chatId;
  const rowActions = actions.map((action) => ({
    name: action,
    label: t(INBOX_ROW_ACTIONS[action].label),
  }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      // Screen readers access swipe actions through the row.
      accessibilityActions={rowActions.length > 0 ? rowActions : undefined}
      onAccessibilityAction={(event) => {
        const name = event.nativeEvent.actionName;
        const action = actions.find((item) => item === name);
        if (action) onAction?.(action);
      }}
      android_ripple={androidRipple()}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.row,
        compact ? styles.compactRow : null,
        selected ? styles.rowSelected : null,
        selected && Platform.OS === "android" && { overflow: "hidden" },
        pressed && Platform.OS !== "android" && styles.rowPressed,
      ]}
    >
      {avatar}
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <View style={styles.titleRow}>
            <Text
              style={[styles.name, unread && styles.unreadName]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {title}
            </Text>
          </View>
          <View style={styles.rowMeta}>
            {time ? <Text style={styles.time}>{time}</Text> : null}
            {unread ? <View accessibilityElementsHidden style={styles.unreadDot} /> : null}
          </View>
        </View>
        <Text style={[styles.preview, unread && styles.unreadPreview]} numberOfLines={1}>
          {preview}
        </Text>
      </View>
    </Pressable>
  );
}

export const ChatRow = memo(function ChatRow({
  chat,
  viewerUserId,
  day,
  onPress,
  onAction,
}: {
  chat: MobileChat;
  viewerUserId: string | undefined;
  day: number;
  onPress: (chat: MobileChat) => void;
  onAction?: (action: InboxRowAction, chat: MobileChat) => void;
}) {
  const { t } = useI18n();
  const title = chat.title || t("New chat");
  const preview = previewSnippet(chat.preview, 40);
  const time = formatThreadTime(chat.lastMessageAt, new Date(day));
  const working = chat.doodle && isRunWorking(chat.status);
  // Spelled out because an explicit label replaces the one built from the row's children.
  const label = [
    title,
    working ? t("Working…") : null,
    chat.muted ? t("notifications silenced") : null,
    chat.unread ? t("unread") : null,
    time,
    preview,
  ]
    .filter(Boolean)
    .join(", ");
  const runAction = (action: InboxRowAction) => onAction?.(action, chat);
  const avatar = (size: number) => (
    <ChatAvatar chat={chat} viewerUserId={viewerUserId} size={size} />
  );
  const row = (
    <ConversationRow
      chatId={chat.id}
      title={title}
      preview={preview}
      time={time}
      unread={chat.unread}
      accessibilityLabel={label}
      onPress={() => onPress(chat)}
      actions={onAction ? [inboxReadAction(chat)] : undefined}
      onAction={runAction}
      avatar={<AvatarRow id={chat.id}>{avatar(INBOX_ROW.avatarSize)}</AvatarRow>}
    />
  );
  return onAction ? (
    <InboxSwipeRow
      rowKey={chat.id}
      unread={chat.unread}
      menuActions={inboxRowActions(chat, viewerUserId)}
      preview={{ title, message: chat.preview, avatar: avatar(32) }}
      onAction={runAction}
    >
      {row}
    </InboxSwipeRow>
  ) : (
    row
  );
});
