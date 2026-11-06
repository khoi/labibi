import { DOODLE_NAME } from "@labradoodle/core";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { mobileTokens } from "../../lib/appearance";
import { useI18n } from "../../lib/i18n";
import { ActivityMark } from "../activity-mark";
import { ScrollToBottomButton } from "../scroll-to-bottom-button";

/** Doodle still working on a reply, under the newest message. */
export function ThreadWorkingFooter({
  working,
  identity,
  status,
  composing,
  label,
  atBottom,
}: {
  working: boolean;
  identity: string;
  status?: string;
  composing: boolean;
  label: string;
  atBottom: boolean;
}) {
  const { t } = useI18n();
  if (!working) return null;
  return (
    <View
      accessibilityLabel={t("{name} is working", { name: DOODLE_NAME })}
      accessibilityRole="text"
      style={{ minHeight: 40, marginTop: 12, justifyContent: "center" }}
    >
      <ActivityMark
        identity={identity}
        status={status}
        composing={composing}
        atBottom={atBottom}
        label={label}
      />
    </View>
  );
}

export function LoadEarlierButton({ loading, onPress }: { loading: boolean; onPress: () => void }) {
  const tokens = mobileTokens();
  const { t } = useI18n();
  return (
    <Pressable
      disabled={loading}
      onPress={onPress}
      style={{
        alignSelf: "center",
        alignItems: "center",
        flexDirection: "row",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      {loading ? (
        <ActivityIndicator color={tokens.mutedForeground} accessibilityLabel={t("Loading…")} />
      ) : null}
      <Text style={{ color: tokens.mutedForeground, fontSize: 13 }}>
        {t("Load earlier messages")}
      </Text>
    </Pressable>
  );
}

/** Floats over the column's trailing corner, with a dot while newer messages wait below. */
export function JumpToLatestButton({
  bottomInset,
  insetEnd,
  unread,
  onPress,
}: {
  bottomInset: number;
  /** Distance from the trailing screen edge to the chat column. */
  insetEnd: number;
  unread: boolean;
  onPress: () => void;
}) {
  const tokens = mobileTokens();
  const { t } = useI18n();
  return (
    <View style={{ position: "absolute", end: insetEnd, bottom: bottomInset + 12 }}>
      <ScrollToBottomButton
        accessibilityLabel={unread ? t("Jump to latest, new messages") : t("Jump to latest")}
        onPress={onPress}
      />
      {unread ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 3,
            end: 3,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: tokens.primary,
          }}
        />
      ) : null}
    </View>
  );
}
