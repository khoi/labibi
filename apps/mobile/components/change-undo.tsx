import type { MessageBlock } from "@labradoodle/contracts";
import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";
import { errorText } from "../lib/user-error";
import { NativeActionButton } from "./native-action-button";

type AskBlock = Extract<MessageBlock, { kind: "ask" }>;

/** Instructions or settings Doodle changed from chat, which its owner can undo. */
export function isUndoableChange(block: MessageBlock): boolean {
  return (
    block.kind === "ask" && Boolean(block.instructionUpdate?.undoVersionId || block.settingsUpdate)
  );
}

export function ChangeUndo({ block }: { block: AskBlock }) {
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const [pending, setPending] = useState(false);
  const [restored, setRestored] = useState(false);
  const { instructionUpdate, settingsUpdate } = block;
  const undo = () =>
    instructionUpdate?.undoVersionId
      ? rpc("doodle/restoreInstructions", {
          versionId: instructionUpdate.undoVersionId,
          expectedInstructions: instructionUpdate.after,
          undo: true,
        })
      : settingsUpdate &&
        rpc("doodle/update", {
          ...settingsUpdate.before,
          expectedSettings: settingsUpdate.after,
        });
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text style={{ color: tokens.foreground }}>
        {instructionUpdate ? t("Instructions updated") : t("Settings updated")}
      </Text>
      <NativeActionButton
        label={t(restored ? "Restored" : "Undo")}
        prominence="plain"
        size="compact"
        disabled={pending || restored}
        onPress={async () => {
          setPending(true);
          try {
            await undo();
            setRestored(true);
          } catch (error) {
            Alert.alert(errorText(error));
          } finally {
            setPending(false);
          }
        }}
      />
    </View>
  );
}
