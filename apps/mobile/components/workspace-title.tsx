import { MenuView } from "@expo/ui/community/menu";
import { Text, View } from "react-native";
import type { MobileWorkspace } from "../lib/api";
import { resolveMobileAppearance } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { native, useThemedStyles } from "../lib/native";
import { createHomeStyles } from "./home-styles";
import { NativeSymbol } from "./native-symbol";

/**
 * The inbox title: the workspace on screen. With more than one workspace it is a native menu
 * that switches between them; a dot says another one has something unread.
 */
export function WorkspaceTitle({
  workspaces,
  currentId,
  disabled,
  onSelect,
}: {
  workspaces: readonly MobileWorkspace[];
  currentId: string | undefined;
  disabled?: boolean;
  onSelect: (spaceId: string) => void;
}) {
  const styles = useThemedStyles(createHomeStyles);
  const { t } = useI18n();
  const current = workspaces.find((workspace) => workspace.id === currentId);
  const name = current?.name ?? "";
  if (workspaces.length < 2)
    return (
      <Text accessibilityRole="header" numberOfLines={1} style={styles.workspaceName}>
        {name}
      </Text>
    );
  const otherUnread = workspaces.some(
    (workspace) => workspace.id !== currentId && workspace.unread,
  );
  return (
    <MenuView
      actions={workspaces.map((workspace) => ({
        id: workspace.id,
        title: workspace.name,
        state: workspace.id === currentId ? ("on" as const) : ("off" as const),
        image: workspace.id !== currentId && workspace.unread ? "circle.fill" : undefined,
      }))}
      colorScheme={resolveMobileAppearance()}
      onPressAction={({ nativeEvent }) => {
        if (!disabled && nativeEvent.event !== currentId) onSelect(nativeEvent.event);
      }}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={name}
        accessibilityHint={otherUnread ? t("unread") : undefined}
        style={styles.workspaceTitle}
      >
        <Text numberOfLines={1} style={styles.workspaceName}>
          {name}
        </Text>
        {otherUnread ? <View accessibilityElementsHidden style={styles.unreadDot} /> : null}
        <NativeSymbol
          ios="chevron.down"
          android="chevron-down"
          size={12}
          color={native.secondaryLabel}
        />
      </View>
    </MenuView>
  );
}
