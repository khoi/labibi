import type { SpaceBot, SpaceGroup } from "@labradoodle/contracts";
import { isRunWorking } from "@labradoodle/core";
import { botColors } from "@labradoodle/ui-tokens";
import type { ReactNode } from "react";
import { createContext, memo, useContext, useEffect } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { MobileBot, MobileGroup } from "../lib/api";
import { AvatarRow } from "../lib/avatar-life";
import { useI18n } from "../lib/i18n";
import { formatThreadTime } from "../lib/inbox";
import type { InboxChatKind, InboxRowAction } from "../lib/inbox-swipe";
import { INBOX_ROW_ACTIONS, inboxReadAction } from "../lib/inbox-swipe";
import { native, useThemedStyles } from "../lib/native";
import { previewSnippet } from "../lib/preview";
import { androidRipple } from "../lib/ripple";
import { BotAvatar } from "./bot-avatar";
import { GroupAvatar } from "./group-avatar";
import { createHomeStyles, INBOX_ROW } from "./home-styles";
import { InboxSwipeRow } from "./inbox-swipe-row";
import { NativeSymbol } from "./native-symbol";

export const FALLBACK_COLOR = botColors[3];
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
            <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">
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

/** Points right while a section is collapsed and turns down as it opens. */
/** A folding section header's title, count, and chevron; `count` shows when given. */
export function SectionToggle({
  title,
  count,
  collapsed,
  onPress,
}: {
  title: string;
  count?: number;
  collapsed: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(createHomeStyles);
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        collapsed ? t("Expand {name}", { name: title }) : t("Collapse {name}", { name: title })
      }
      accessibilityState={{ expanded: !collapsed }}
      accessibilityValue={count === undefined ? undefined : { text: String(count) }}
      onPress={onPress}
      style={({ pressed }) => [styles.sectionToggle, pressed && styles.rowPressed]}
    >
      <Text style={styles.sectionTitle}>{title}</Text>
      {count === undefined ? null : <Text style={styles.sectionCount}>{count}</Text>}
      <SectionChevron collapsed={collapsed} />
    </Pressable>
  );
}

export function SectionChevron({ collapsed }: { collapsed: boolean }) {
  const rotation = useSharedValue(collapsed ? 0 : 90);
  useEffect(() => {
    rotation.value = withTiming(collapsed ? 0 : 90, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    });
  }, [collapsed, rotation]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));
  return (
    <Animated.View style={style}>
      <NativeSymbol
        ios="chevron.right"
        android="chevron-forward"
        size={12}
        color={native.tertiaryLabel}
      />
    </Animated.View>
  );
}

/** What the iOS row menu needs to change a chat in place. */
type RowMenuProps = {
  onNotifyChange: (
    kind: InboxChatKind,
    chat: MobileBot | MobileGroup | SpaceBot | SpaceGroup,
    notifyOnFinish: boolean,
  ) => void;
};

export const BotRow = memo(function BotRow({
  bot,
  day,
  onPress,
  onAction,
  onNotifyChange,
}: {
  bot: MobileBot | SpaceBot;
  day: number;
  onPress: (bot: MobileBot | SpaceBot) => void;
  onAction?: (action: InboxRowAction, bot: MobileBot | SpaceBot) => void;
} & RowMenuProps) {
  const { t } = useI18n();
  const preview = previewSnippet(bot.preview, 40) || t("No messages yet");
  const time = bot.updatedAt ? formatThreadTime(bot.updatedAt, new Date(day)) : "";
  const working = isRunWorking(bot.status);
  // Spelled out because an explicit label replaces the one built from the row's children.
  const label = [
    bot.name,
    working ? t("Working…") : null,
    bot.notifyOnFinish === false ? t("notifications silenced") : null,
    bot.unread ? t("unread") : null,
    time,
    preview,
  ]
    .filter(Boolean)
    .join(", ");
  const runAction = (action: InboxRowAction) => onAction?.(action, bot);
  const row = (
    <ConversationRow
      chatId={bot.id}
      title={bot.name}
      preview={preview}
      time={time}
      unread={bot.unread}
      accessibilityLabel={label}
      onPress={() => onPress(bot)}
      actions={onAction ? [inboxReadAction(bot)] : undefined}
      onAction={runAction}
      avatar={
        <AvatarRow id={bot.id}>
          <BotAvatar
            color={bot.color || FALLBACK_COLOR}
            identity={bot.id}
            size={INBOX_ROW.avatarSize}
            status={bot.status}
            muted={bot.notifyOnFinish === false}
            motion="lazy"
          />
        </AvatarRow>
      }
    />
  );
  return onAction ? (
    <InboxSwipeRow
      rowKey={`bot:${bot.id}`}
      unread={bot.unread}
      notifyOnFinish={bot.notifyOnFinish}
      preview={{
        title: bot.name,
        message: bot.preview,
        avatar: <BotAvatar color={bot.color || FALLBACK_COLOR} identity={bot.id} size={32} />,
      }}
      onAction={runAction}
      onNotifyChange={(notify) => onNotifyChange("bot", bot, notify)}
    >
      {row}
    </InboxSwipeRow>
  ) : (
    row
  );
});

export const GroupRow = memo(function GroupRow({
  group,
  day,
  onPress,
  onAction,
  onNotifyChange,
}: {
  group: MobileGroup | SpaceGroup;
  day: number;
  onPress: (group: MobileGroup | SpaceGroup) => void;
  onAction?: (action: InboxRowAction, group: MobileGroup | SpaceGroup) => void;
} & RowMenuProps) {
  const { t } = useI18n();
  const preview =
    previewSnippet(group.preview, 40) || group.members.map((member) => member.name).join(", ");
  const time = group.updatedAt ? formatThreadTime(group.updatedAt, new Date(day)) : "";
  const runAction = (action: InboxRowAction) => onAction?.(action, group);
  const row = (
    <ConversationRow
      chatId={group.id}
      title={group.name}
      preview={preview}
      time={time}
      unread={group.unread}
      accessibilityLabel={[group.name, group.unread ? t("unread") : null, time, preview]
        .filter(Boolean)
        .join(", ")}
      onPress={() => onPress(group)}
      actions={onAction ? [inboxReadAction(group)] : undefined}
      onAction={runAction}
      avatar={<GroupAvatar members={group.members} size={INBOX_ROW.avatarSize} />}
    />
  );
  return onAction ? (
    <InboxSwipeRow
      rowKey={`group:${group.id}`}
      unread={group.unread}
      preview={{
        title: group.name,
        message: group.preview,
        avatar: <GroupAvatar members={group.members} size={32} />,
      }}
      onAction={runAction}
      onNotifyChange={(notify) => onNotifyChange("group", group, notify)}
    >
      {row}
    </InboxSwipeRow>
  ) : (
    row
  );
});
