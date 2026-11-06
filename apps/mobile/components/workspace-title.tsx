import { MenuView } from "@expo/ui/community/menu";
import { Text, useWindowDimensions, View } from "react-native";
import type { MobileWorkspace } from "../lib/api";
import { resolveMobileAppearance } from "../lib/appearance";
import { useI18n } from "../lib/i18n";
import { native, useThemedStyles } from "../lib/native";
import { HEADER_CONTROL_SIZE } from "../lib/native-controls";
import { createHomeStyles } from "./home-styles";
import { NativeSymbol } from "./native-symbol";

const HEADER_ITEMS_WIDTH = 3 * HEADER_CONTROL_SIZE + 62;

/**
 * The inbox title: the workspace on screen. With more than one workspace it is a native menu
 * that switches between them; a dot says another one has something unread.
 */
export function WorkspaceTitle({
  workspaces,
  current,
  disabled,
  onSelect,
}: {
  workspaces: readonly MobileWorkspace[];
  current: MobileWorkspace;
  disabled?: boolean;
  onSelect: (spaceId: string) => void;
}) {
  const styles = useThemedStyles(createHomeStyles);
  const { t } = useI18n();
  const { id: currentId, name } = current;
  const maxWidth = useWindowDimensions().width - HEADER_ITEMS_WIDTH;
  if (workspaces.length < 2)
    return (
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={[styles.workspaceName, { maxWidth }]}
      >
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
        style={[styles.workspaceTitle, { maxWidth }]}
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
