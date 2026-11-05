import { MenuView } from "@expo/ui/community/menu";
import type { SpaceBot, SpaceGroup } from "@labradoodle/contracts";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import type { MobileBot, MobileGroup } from "../lib/api";
import type { ResolvedAppearance } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import type { InboxItem } from "../lib/inbox-spaces";
import { useThemedStyles } from "../lib/native";
import type { useInboxChatActions } from "../lib/use-inbox-chat-actions";
import { createHomeStyles } from "./home-styles";
import { BotRow, GroupRow } from "./inbox-rows";
import { NativeSymbol } from "./native-symbol";

// Swipe actions and the context menu are iOS list behaviour.
export const SWIPE_ROWS = Platform.OS === "ios";

type ChatActions = ReturnType<typeof useInboxChatActions>;

/** The inbox list's row renderer: space headings and chat rows. */
export function useInboxRenderItem({
  appearance,
  botAction,
  chooseInboxSpace,
  day,
  groupAction,
  spaceId,
  openBot,
  openGroup,
  notifyFromMenu,
  sharing,
  spaceBusy,
}: Pick<ChatActions, "botAction" | "groupAction" | "notifyFromMenu"> & {
  appearance: ResolvedAppearance;
  chooseInboxSpace: (spaceId: string) => void;
  day: number;
  /** The selected space: only its chats get swipe actions and the row menu. */
  spaceId: string | undefined;
  openBot: (bot: MobileBot | SpaceBot) => void;
  openGroup: (group: MobileGroup | SpaceGroup) => void;
  /** Picking a chat for an incoming share: rows only open, without menus or swipe actions. */
  sharing: boolean;
  spaceBusy: boolean;
}) {
  const styles = useThemedStyles(createHomeStyles);
  const { t } = useI18n();
  const router = useRouter();
  return useCallback(
    ({ item }: { item: InboxItem }) =>
      item.type === "heading" ? (
        <View style={styles.spaceHeading}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.title}
            accessibilityState={{
              selected: item.space.id === spaceId,
              disabled: spaceBusy,
            }}
            disabled={spaceBusy}
            onPress={() => {
              if (item.space) void chooseInboxSpace(item.space.id);
            }}
            style={({ pressed }) => [styles.spaceSelect, pressed && styles.rowPressed]}
          >
            <Text style={styles.spaceTitle}>{item.title}</Text>
          </Pressable>
          {sharing ? null : (
            <MenuView
              actions={[{ id: "members", title: t("Members"), image: "person.2" }]}
              colorScheme={appearance}
              onPressAction={() => {
                if (!item.space) return;
                router.push({
                  pathname: "/space-members",
                  params: { spaceId: item.space.id, name: item.space.name },
                });
              }}
            >
              <View
                accessibilityLabel={t("Space actions for {name}", { name: item.title })}
                accessibilityRole="button"
                style={styles.spaceActions}
              >
                <NativeSymbol ios="ellipsis" android="ellipsis-horizontal" size={20} />
              </View>
            </MenuView>
          )}
        </View>
      ) : item.type === "group" ? (
        <GroupRow
          group={item.group}
          day={day}
          onPress={openGroup}
          onAction={SWIPE_ROWS && item.group.spaceId === spaceId ? groupAction : undefined}
          onNotifyChange={notifyFromMenu}
        />
      ) : (
        <BotRow
          bot={item.bot}
          day={day}
          onPress={openBot}
          onAction={!sharing && SWIPE_ROWS && item.bot.spaceId === spaceId ? botAction : undefined}
          onNotifyChange={notifyFromMenu}
        />
      ),
    [
      appearance,
      botAction,
      chooseInboxSpace,
      day,
      groupAction,
      spaceId,
      openBot,
      openGroup,
      notifyFromMenu,
      router,
      sharing,
      spaceBusy,
      styles,
      t,
    ],
  );
}
