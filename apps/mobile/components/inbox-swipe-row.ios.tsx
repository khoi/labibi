import { Button, ContextMenu, Host, List, RNHostView, SwipeActions } from "@expo/ui/swift-ui";
import {
  contentShape,
  labelStyle,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listStyle,
  scrollContentBackground,
  scrollDisabled,
  shapes,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useState } from "react";
import { PlatformColor, useWindowDimensions, View } from "react-native";
import { useI18n } from "../lib/i18n";
import type { InboxRowAction } from "../lib/inbox-swipe";
import { INBOX_ROW_ACTIONS, inboxReadAction } from "../lib/inbox-swipe";
import { native, useResolvedAppearance } from "../lib/native";
import { InboxChatPreview } from "./inbox-chat-preview";
import type { InboxSwipeRowProps } from "./inbox-swipe-row";

// Measured row heights, so recycled and reopened rows start at their size instead of 0.
const rowHeights = new Map<string, number>();
let lastRowHeight = 0;

/**
 * The inbox row inside a one-row SwiftUI list, which is what gives it the system swipe
 * actions, full swipe and haptics, and the system context menu on long press. The FlatList
 * around it keeps scrolling and sections.
 */
export function InboxSwipeRow({
  rowKey,
  unread,
  notifyOnFinish,
  preview,
  onAction,
  onNotifyChange,
  children,
}: InboxSwipeRowProps) {
  const { t } = useI18n();
  const scheme = useResolvedAppearance();
  const window = useWindowDimensions();
  const [width, setWidth] = useState(window.width);
  const [height, setHeight] = useState(() => rowHeights.get(rowKey) ?? lastRowHeight);
  const readAction = inboxReadAction({ unread });

  function button(action: InboxRowAction, swipe = true) {
    const { label, systemImage } = INBOX_ROW_ACTIONS[action];
    return (
      <Button
        key={action}
        label={t(label)}
        systemImage={systemImage}
        role={!swipe && action === "delete" ? "destructive" : undefined}
        modifiers={swipe ? [labelStyle("iconOnly"), tint(PlatformColor("systemBlue"))] : undefined}
        onPress={() => onAction(action)}
      />
    );
  }

  return (
    <View
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        if (next > 0 && next !== width) setWidth(next);
      }}
    >
      <Host style={{ height }} colorScheme={scheme} ignoreSafeArea="all">
        <List
          modifiers={[listStyle("plain"), scrollDisabled(true), scrollContentBackground("hidden")]}
        >
          <SwipeActions
            modifiers={[
              listRowInsets({ top: 0, leading: 0, bottom: 0, trailing: 0 }),
              listRowSeparator("hidden"),
              listRowBackground(native.page),
            ]}
          >
            <ContextMenu modifiers={[contentShape(shapes.rectangle())]}>
              <ContextMenu.Trigger>
                <RNHostView matchContents>
                  <View
                    style={{ width }}
                    onLayout={(event) => {
                      const next = Math.ceil(event.nativeEvent.layout.height);
                      if (next <= 0 || next === height) return;
                      rowHeights.set(rowKey, next);
                      lastRowHeight = next;
                      setHeight(next);
                    }}
                  >
                    {children}
                  </View>
                </RNHostView>
              </ContextMenu.Trigger>
              <ContextMenu.Preview>
                <InboxChatPreview {...preview} />
              </ContextMenu.Preview>
              <ContextMenu.Items>
                {button(readAction, false)}
                {notifyOnFinish === undefined ? null : (
                  <Button
                    label={notifyOnFinish ? t("Silence notifications") : t("Resume notifications")}
                    systemImage={notifyOnFinish ? "bell.slash" : "bell"}
                    onPress={() => onNotifyChange(!notifyOnFinish)}
                  />
                )}
                {button("delete", false)}
              </ContextMenu.Items>
            </ContextMenu>
            <SwipeActions.Actions edge="leading">{button(readAction)}</SwipeActions.Actions>
          </SwipeActions>
        </List>
      </Host>
    </View>
  );
}
