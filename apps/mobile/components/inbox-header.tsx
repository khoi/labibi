import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../lib/i18n";
import { useThemedStyles } from "../lib/native";
import { createHomeStyles } from "./home-styles";
import { NativeSymbol } from "./native-symbol";

/** The inbox's own header where the native Liquid Glass bar is unavailable. */
export function InboxHeader({
  initials,
  newChat,
  columnInsets,
  title,
}: {
  initials: string;
  newChat: () => void;
  columnInsets: { left: number; right: number };
  title?: ReactNode;
}) {
  const styles = useThemedStyles(createHomeStyles);
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.header,
        {
          paddingTop: Math.max(insets.top, 20) + 8,
          paddingLeft: 16 + columnInsets.left,
          paddingRight: 16 + columnInsets.right,
        },
      ]}
    >
      <View style={styles.circleButton}>
        <HeaderButton accessibilityLabel={t("Account")} onPress={() => router.push("/account")}>
          <Text style={styles.profileInitials}>{initials}</Text>
        </HeaderButton>
      </View>
      {title}
      <View style={styles.headerActions}>
        <HeaderButton
          testID="home-search-button"
          accessibilityLabel={t("Search")}
          onPress={() => router.push("/search")}
        >
          <NativeSymbol ios="magnifyingglass" android="search" size={17} />
        </HeaderButton>
        <HeaderButton
          testID="home-new-chat-button"
          accessibilityLabel={t("New chat")}
          onPress={newChat}
        >
          <NativeSymbol ios="plus" android="add" size={18} />
        </HeaderButton>
      </View>
    </View>
  );
}

function HeaderButton({
  testID,
  children,
  onPress,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const styles = useThemedStyles(createHomeStyles);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.headerButton, pressed && styles.headerButtonActive]}
    >
      {children}
    </Pressable>
  );
}
