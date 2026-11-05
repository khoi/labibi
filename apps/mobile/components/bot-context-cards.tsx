import type { MemoryDocument } from "@labradoodle/contracts";
import { isEmptyBotMemory } from "@labradoodle/contracts";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { native, useMobileTokens } from "../lib/native";
import { errorText } from "../lib/user-error";
import { NativeSymbol } from "./native-symbol";

export function BotContextCards({ botId }: { botId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const tokens = useMobileTokens();
  const [docs, setDocs] = useState<MemoryDocument[]>([]);
  const [allDocs, setAllDocs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reload on return, so an edited or deleted note shows its saved state.
  useFocusEffect(
    useCallback(() => {
      let current = true;
      setError(null);
      void rpc("memory/list", { botId, scope: "bot" })
        .then((documents) => {
          if (current) setDocs(documents.filter((doc) => !isEmptyBotMemory(doc)));
        })
        .catch((err) => {
          if (current) setError(errorText(err));
        });
      return () => {
        current = false;
      };
    }, [botId]),
  );
  const heading = { color: tokens.mutedForeground, fontSize: 12, fontWeight: "500" as const };
  const card = { backgroundColor: native.fill, borderRadius: 12, padding: 16, gap: 12 };
  return (
    <>
      {docs.length ? (
        <View style={{ marginTop: 24 }}>
          <Text accessibilityRole="header" style={[heading, { marginBottom: 8 }]}>
            {t("Memory")}
          </Text>
          <View style={card}>
            {(allDocs ? docs : docs.slice(0, 5)).map((doc) => (
              <Pressable
                key={doc.id}
                accessibilityRole="button"
                accessibilityLabel={doc.path}
                onPress={() =>
                  router.push({ pathname: "/memory-note", params: { id: doc.id, botId } })
                }
                style={{
                  minHeight: 44,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <Text numberOfLines={1} style={{ color: tokens.foreground, fontSize: 14, flex: 1 }}>
                  {doc.path}
                </Text>
                <NativeSymbol
                  ios="chevron.right"
                  android="chevron-forward"
                  size={14}
                  color={native.tertiaryLabel}
                />
              </Pressable>
            ))}
            {!allDocs && docs.length > 5 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setAllDocs(true)}
                style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={{ color: tokens.mutedForeground }}>{t("Show more")}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
      {error ? <Text style={{ color: tokens.destructive, marginTop: 16 }}>{error}</Text> : null}
    </>
  );
}
