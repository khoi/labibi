import { useNavigation, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useLayoutEffect } from "react";
import { useI18n } from "./i18n";

/** Liquid Glass home header: account on the left, the workspace as its title, search and new chat on the right. */
export function useHomeHeader({
  nativeHeader,
  ready,
  hasSession,
  newChat,
  headerTitle,
}: {
  nativeHeader: boolean;
  ready: boolean;
  hasSession: boolean;
  newChat: () => void;
  headerTitle?: () => ReactNode;
}) {
  const navigation = useNavigation();
  const router = useRouter();
  const { t, locale } = useI18n();
  useLayoutEffect(() => {
    if (!nativeHeader) return;
    const signedIn = ready && hasSession;
    navigation.setOptions({
      headerShown: signedIn,
      headerTransparent: true,
      headerStyle: { backgroundColor: "transparent" },
      title: "",
      headerTitle,
      unstable_headerLeftItems: () => [
        {
          type: "button" as const,
          label: t("Account"),
          icon: { type: "sfSymbol" as const, name: "person.crop.circle" },
          accessibilityLabel: t("Account"),
          onPress: () => router.push("/account"),
        },
      ],
      unstable_headerRightItems: () => [
        {
          type: "button" as const,
          label: t("Search"),
          accessibilityLabel: t("Search"),
          identifier: "home-search-button",
          icon: { type: "sfSymbol" as const, name: "magnifyingglass" },
          onPress: () => router.push("/search"),
        },
        {
          type: "button" as const,
          label: t("New chat"),
          accessibilityLabel: t("New chat"),
          identifier: "home-new-chat-button",
          icon: { type: "sfSymbol" as const, name: "plus" },
          onPress: newChat,
        },
      ],
    });
  }, [nativeHeader, navigation, ready, hasSession, newChat, headerTitle, router, t, locale]);
}
