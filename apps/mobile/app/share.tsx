import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassIconButton } from "../components/glass-icon-button";
import { NativeSymbol } from "../components/native-symbol";
import { loadSessionToken, rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import {
  cancelIncomingShare,
  getIncomingShare,
  subscribeIncomingShare,
} from "../lib/incoming-share";
import { useMobileTokens } from "../lib/native";
import { addToSearchInbox } from "../lib/search-inbox";
import { sharePreview } from "../lib/share-preview";
import { errorText } from "../lib/user-error";

/** Something shared from another app opens a new chat with you and Doodle, the share in its composer. */
export default function ShareRoute() {
  const router = useRouter();
  const navigation = useNavigation();
  const share = useSyncExternalStore(subscribeIncomingShare, getIncomingShare);
  const selected = useRef(false);
  const closing = useRef(false);
  const tokens = useMobileTokens();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const close = useCallback(() => {
    closing.current = true;
    cancelIncomingShare();
    router.dismissTo("/");
  }, [router]);

  useEffect(
    () =>
      navigation.addListener("beforeRemove", (event) => {
        const payload = event.data.action.payload;
        // Authentication temporarily replaces the picker; sign-in returns here with the share.
        if (payload && "name" in payload && payload.name === "sign-in") return;
        if (selected.current || closing.current) return;
        event.preventDefault();
        close();
      }),
    [navigation, close],
  );
  useEffect(() => {
    if (!share && !selected.current && !closing.current) close();
  }, [share, close]);

  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!share || started.current) return;
    started.current = true;
    void (async () => {
      // Signed out, the sign-in screen takes over and comes back here with the share.
      if (!(await loadSessionToken())) {
        router.replace("/sign-in");
        return;
      }
      try {
        const chat = await rpc("threads/create", { userIds: [], doodle: true });
        // Removal must preserve the share for thread.tsx to claim it.
        if (!getIncomingShare()) return;
        addToSearchInbox(chat);
        selected.current = true;
        navigation.dispatch({
          type: "RESET",
          payload: {
            index: 1,
            routes: [{ name: "index" }, { name: "thread", params: { threadId: chat.id } }],
          },
        });
      } catch (err) {
        setError(errorText(err, t("Could not start chat")));
      }
    })();
  }, [share, navigation, router, t]);
  const preview = share ? sharePreview(share) : null;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tokens.background,
        paddingTop: insets.top + 8,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          marginHorizontal: 16,
          marginBottom: 12,
        }}
      >
        <GlassIconButton
          testID="share-close"
          accessibilityLabel={t("Close")}
          ios="xmark"
          android="close"
          size={44}
          color={tokens.foreground}
          fallbackStyle={{ backgroundColor: tokens.muted }}
          onPress={close}
        />
        <Text
          accessibilityRole="header"
          style={{ fontSize: 20, fontWeight: "600", color: tokens.foreground }}
        >
          {t("New chat")}
        </Text>
      </View>
      {preview ? (
        <View style={{ marginHorizontal: 20, paddingBottom: 12, gap: 8 }}>
          {preview.text ? (
            <Text numberOfLines={2} style={{ fontSize: 15, color: tokens.mutedForeground }}>
              {preview.text}
            </Text>
          ) : null}
          {preview.images.length ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              {preview.images.map((file, index) => (
                <Image
                  key={`${file.uri}:${index}`}
                  source={{ uri: file.uri }}
                  style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: tokens.muted }}
                />
              ))}
              {preview.extraImages ? (
                <Text style={{ alignSelf: "center", color: tokens.mutedForeground }}>
                  +{preview.extraImages}
                </Text>
              ) : null}
            </View>
          ) : null}
          {preview.fileCount ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <NativeSymbol
                ios="doc"
                android="document-outline"
                size={20}
                color={tokens.mutedForeground}
              />
              <Text
                numberOfLines={1}
                style={{ flex: 1, fontSize: 15, color: tokens.mutedForeground }}
              >
                {preview.fileName ?? t("{count} files", { count: preview.fileCount })}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={{ paddingTop: 24, alignItems: "center" }}>
        {error ? (
          <Text style={{ color: tokens.destructive }}>{error}</Text>
        ) : (
          <ActivityIndicator color={tokens.mutedForeground} />
        )}
      </View>
    </View>
  );
}
