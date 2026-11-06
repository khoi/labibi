import type { NativeStackNavigationOptions } from "expo-router";
import { router } from "expo-router";
import { Pressable } from "react-native";
import { iosAtLeast } from "../lib/native-controls";
import { NativeSymbol } from "./native-symbol";

export function openInvite() {
  router.push("/invite");
}

/**
 * A chat header's right side: the invite gift when the account can invite. The chat's own
 * settings open from its title. The chat route declares it when the screen is created, so the
 * title is centred against it from the first frame; both use this one builder so the item never
 * changes shape.
 */
export function threadHeaderRight({
  readOnly,
  t,
  color,
  onInvite,
}: {
  readOnly: boolean;
  t: (text: string) => string;
  color: string;
  /** Opens the invite sheet; absent when the account cannot invite. */
  onInvite?: () => void;
}): NativeStackNavigationOptions {
  const label = t("Invite a friend");
  if (readOnly || !onInvite)
    return { headerRight: undefined, unstable_headerRightItems: undefined };
  return {
    ...(iosAtLeast(26)
      ? {
          unstable_headerRightItems: () => [
            {
              type: "button" as const,
              label,
              accessibilityLabel: label,
              icon: { type: "sfSymbol" as const, name: "gift" },
              onPress: onInvite,
            },
          ],
        }
      : { unstable_headerRightItems: undefined }),
    headerRight: () => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={8}
        onPress={onInvite}
      >
        <NativeSymbol ios="gift" android="gift-outline" size={21} color={color} />
      </Pressable>
    ),
  };
}
