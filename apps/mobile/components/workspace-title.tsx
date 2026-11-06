import type { MenuAction } from "@expo/ui/community/menu";
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

const INVITE_ACTION = "action:invite";
const MEMBERS_ACTION = "action:members";

export function WorkspaceTitle({
  workspaces,
  current,
  disabled,
  onSelect,
  onInvite,
  onMembers,
}: {
  workspaces: readonly MobileWorkspace[];
  current: MobileWorkspace;
  disabled?: boolean;
  onSelect: (spaceId: string) => void;
  onInvite: () => void;
  onMembers: () => void;
}) {
  const styles = useThemedStyles(createHomeStyles);
  const { t } = useI18n();
  const { id: currentId, name } = current;
  const maxWidth = useWindowDimensions().width - HEADER_ITEMS_WIDTH;
  const otherUnread = workspaces.some(
    (workspace) => workspace.id !== currentId && workspace.unread,
  );
  const actions: MenuAction[] = [];
  if (workspaces.length > 1)
    actions.push({
      id: "workspaces",
      title: "",
      displayInline: true,
      subactions: workspaces.map((workspace) => ({
        id: workspace.id,
        title: workspace.name,
        state: workspace.id === currentId ? "on" : "off",
        image: workspace.id !== currentId && workspace.unread ? "circle.fill" : undefined,
      })),
    });
  if (current.isOwner)
    actions.push({ id: INVITE_ACTION, title: t("Invite people"), image: "person.badge.plus" });
  actions.push({ id: MEMBERS_ACTION, title: t("Members"), image: "person.2" });
  return (
    <MenuView
      actions={actions}
      colorScheme={resolveMobileAppearance()}
      onPressAction={({ nativeEvent }) => {
        const action = nativeEvent.event;
        if (action === INVITE_ACTION) onInvite();
        else if (action === MEMBERS_ACTION) onMembers();
        else if (!disabled && action !== currentId) onSelect(action);
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
