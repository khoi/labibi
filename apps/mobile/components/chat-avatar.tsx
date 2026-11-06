import type { ChatMember } from "@labradoodle/contracts";
import { accountDisplay } from "@labradoodle/core";
import { memo } from "react";
import type { ViewStyle } from "react-native";
import { Image, StyleSheet, Text, View } from "react-native";
import type { MobileChat } from "../lib/api";
import { native, useThemedStyles } from "../lib/native";
import { DoodleAvatar } from "./doodle-avatar";
import { NativeSymbol } from "./native-symbol";

/** A person's photo, or the first letter of their name on a plain circle. */
export const PersonAvatar = memo(function PersonAvatar({
  person,
  size = 54,
}: {
  person: Pick<ChatMember, "name" | "image">;
  size?: number;
}) {
  const styles = useThemedStyles(createChatAvatarStyles);
  const display = accountDisplay(person, "");
  const circle = { width: size, height: size, borderRadius: size / 2 };
  if (display.image)
    return <Image source={{ uri: display.image }} style={[styles.fallback, circle]} />;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.fallback, circle]}
    >
      {display.initial ? (
        <Text style={[styles.initial, { fontSize: Math.round(size * 0.42) }]}>
          {display.initial}
        </Text>
      ) : (
        <NativeSymbol
          ios="person.fill"
          android="person"
          size={Math.round(size * 0.45)}
          color={native.secondaryLabel}
        />
      )}
    </View>
  );
});

/**
 * A chat as the list shows it: the other people in it, else Doodle when it is on, else a plain
 * chat mark.
 */
export const ChatAvatar = memo(function ChatAvatar({
  chat,
  viewerUserId,
  size = 54,
}: {
  chat: Pick<MobileChat, "id" | "doodle" | "members" | "status">;
  viewerUserId: string | undefined;
  size?: number;
}) {
  const styles = useThemedStyles(createChatAvatarStyles);
  const others = chat.members.filter((member) => member.userId !== viewerUserId);
  if (others.length === 0) {
    if (chat.doodle)
      return <DoodleAvatar identity={chat.id} size={size} status={chat.status} motion="lazy" />;
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}
      >
        <NativeSymbol
          ios="bubble.left.fill"
          android="chatbubble"
          size={Math.round(size * 0.42)}
          color={native.secondaryLabel}
        />
      </View>
    );
  }
  if (others.length === 1) return <PersonAvatar person={others[0]!} size={size} />;
  const pair = others.length === 2;
  const miniSize = Math.round(size * (pair ? 0.65 : 0.54));
  const positions: ViewStyle[] = pair
    ? [
        { top: 0, left: 0 },
        { right: 0, bottom: 0 },
      ]
    : [
        { top: 0, left: (size - miniSize) / 2 },
        { bottom: 0, left: 0 },
        { right: 0, bottom: 0 },
      ];
  const visible = others.slice(0, pair || others.length === 3 ? others.length : 2);
  return (
    <View style={{ width: size, height: size, position: "relative" }}>
      {visible.map((person, index) => (
        <View
          key={person.userId}
          style={{ position: "absolute", ...positions[index], zIndex: index + 1 }}
        >
          <PersonAvatar person={person} size={miniSize} />
        </View>
      ))}
      {others.length > 3 ? (
        <View
          style={[styles.more, { width: miniSize, height: miniSize, borderRadius: miniSize / 2 }]}
        >
          <Text style={styles.moreText}>+{others.length - 2}</Text>
        </View>
      ) : null}
    </View>
  );
});

function createChatAvatarStyles() {
  return StyleSheet.create({
    fallback: {
      backgroundColor: native.fillPressed,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    initial: { color: native.label, fontWeight: "600" },
    more: {
      position: "absolute",
      right: 0,
      bottom: 0,
      zIndex: 3,
      backgroundColor: native.fillPressed,
      alignItems: "center",
      justifyContent: "center",
    },
    moreText: { color: native.label, fontSize: 10, fontWeight: "600" },
  });
}
