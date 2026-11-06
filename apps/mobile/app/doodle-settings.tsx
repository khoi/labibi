import type { ThinkingLevel, UpdateDoodleInput, VoiceInfo } from "@labradoodle/contracts";
import { BOT_INSTRUCTIONS_MAX_LENGTH, BUILTIN_TOOL_NAMES } from "@labradoodle/contracts";
import {
  DOODLE_NAME,
  doodleModelSelection,
  MODEL_SEARCH_THRESHOLD,
  parseModelOptionKey,
} from "@labradoodle/core";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { DoodleAvatar } from "../components/doodle-avatar";
import { glassHeaderOptions } from "../components/glass-title";
import { GrowingTextInput } from "../components/growing-text-input";
import type { MenuPickerChoice } from "../components/menu-picker";
import { MenuPicker, MenuPickerMenu } from "../components/menu-picker";
import { NativeActionButton } from "../components/native-action-button";
import { NativeSwitch } from "../components/native-switch";
import { NativeSymbol } from "../components/native-symbol";
import type { MobileMe, MobileModel, MobileModelCredential } from "../lib/api";
import { rpc } from "../lib/api";
import { useDoodle } from "../lib/doodle";
import { doodleModelPickerChoices } from "../lib/doodle-model";
import { useI18n } from "../lib/i18n";
import { native, useMobileTokens } from "../lib/native";
import { useSideInsets } from "../lib/side-insets";
import { thinkingLevelLabel } from "../lib/thinking-level";
import { errorText } from "../lib/user-error";

function toolLabel(name: string) {
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The workspace's Doodle, for its owner: instructions and their history, model and thinking,
 * the tools it may not use, and its voice. Changes made elsewhere show as they happen.
 */
export default function DoodleSettingsScreen() {
  const sideInsets = useSideInsets();
  const tokens = useMobileTokens();
  const { t } = useI18n();
  const router = useRouter();
  const { model: pickedModel } = useLocalSearchParams<{ model?: string }>();
  const { doodle, setDoodle, error: loadError } = useDoodle(true);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<MobileModelCredential[]>([]);
  const [catalog, setCatalog] = useState<MobileModel[]>([]);
  const [me, setMe] = useState<MobileMe | null>(null);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const draft = instructions ?? doodle?.instructions ?? "";

  useEffect(() => {
    void Promise.all([rpc("me"), rpc("models/list"), rpc("models/credentials")])
      .then(([nextMe, nextCatalog, nextCredentials]) => {
        setMe(nextMe);
        setCatalog(nextCatalog);
        setCredentials(nextCredentials);
      })
      .catch((err) => setError(errorText(err, t("Could not load model settings"))));
    void rpc("voice/voices", {})
      .then(setVoices)
      .catch(() => setVoices([]));
  }, [t]);

  async function save(input: UpdateDoodleInput) {
    if (pending) return false;
    setPending(true);
    setError(null);
    try {
      setDoodle(await rpc("doodle/update", input));
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    } finally {
      setPending(false);
    }
  }

  const { selectedKey: selectedModelKey, thinkingLevels: thinkingOptions } = doodleModelSelection({
    saved: { provider: doodle?.modelProvider ?? null, modelId: doodle?.modelId ?? null },
    ownDefault: { provider: me?.defaultProvider, modelId: me?.defaultModel },
    catalog,
    credentials,
  });
  const modelChoices = useMemo(
    () => doodleModelPickerChoices(me, catalog, credentials, selectedModelKey, t),
    [catalog, credentials, me, selectedModelKey, t],
  );
  const thinkingChoices: MenuPickerChoice[] = [
    { key: "", label: t("Default") },
    ...thinkingOptions.map((level) => ({ key: level, label: thinkingLevelLabel(level, t) })),
  ];

  function selectModel(key: string) {
    if (key === selectedModelKey) return;
    const picked = key ? parseModelOptionKey(key) : null;
    void save({
      modelProvider: picked?.provider ?? null,
      modelId: picked?.modelId ?? null,
      thinkingLevel: null,
    });
  }

  // Only the workspace's owner sets Doodle up; anyone else who lands here goes back.
  useEffect(() => {
    if (doodle && !doodle.canCustomize) router.back();
  }, [doodle?.canCustomize]);

  // The searchable model list hands its pick back as a one-shot route param.
  useEffect(() => {
    if (pickedModel === undefined || !doodle) return;
    router.setParams({ model: undefined });
    selectModel(pickedModel);
  }, [pickedModel, doodle]);

  if (!doodle?.canCustomize) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={glassHeaderOptions(DOODLE_NAME)} />
        {loadError ? (
          <Text style={{ color: tokens.destructive }}>{loadError}</Text>
        ) : (
          <ActivityIndicator color={native.secondaryLabel} />
        )}
      </View>
    );
  }
  const disabledTools = doodle.disabledBuiltinTools;
  const instructionsChanged = draft !== doodle.instructions;

  function restore(versionId: string) {
    if (!doodle || pending || instructionsChanged) return;
    const version = doodle.instructionHistory.find((item) => item.id === versionId);
    if (!version) return;
    Alert.alert(t("Restore"), version.instructions, [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Restore"),
        onPress: () =>
          void rpc("doodle/restoreInstructions", {
            versionId,
            expectedInstructions: doodle.instructions,
          })
            .then((updated) => {
              setDoodle(updated);
              setInstructions(null);
            })
            .catch((err) => setError(errorText(err))),
      },
    ]);
  }

  return (
    <>
      <Stack.Screen options={glassHeaderOptions(DOODLE_NAME)} />
      <ScrollView
        style={[{ flex: 1, backgroundColor: tokens.background }, sideInsets]}
        contentContainerStyle={{ padding: 24, gap: 24 }}
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={{ alignItems: "center" }}>
          <DoodleAvatar size={64} />
        </View>
        <View>
          <View style={styles.headingRow}>
            <SectionHeading>{t("Instructions")}</SectionHeading>
            {doodle.instructionHistory.length && !instructionsChanged ? (
              <MenuPickerMenu
                label={t("Instruction history")}
                value=""
                choices={doodle.instructionHistory.map((version) => ({
                  key: version.id,
                  label: `${new Date(version.createdAt).toLocaleString()} (${version.reason})`,
                }))}
                onChange={restore}
              >
                <View
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={t("Instruction history")}
                  style={styles.historyButton}
                >
                  <NativeSymbol
                    ios="clock.arrow.circlepath"
                    android="time-outline"
                    size={18}
                    color={tokens.mutedForeground}
                  />
                </View>
              </MenuPickerMenu>
            ) : null}
          </View>
          <GrowingTextInput
            label={t("Instructions")}
            maxLength={BOT_INSTRUCTIONS_MAX_LENGTH}
            value={draft}
            onChangeText={setInstructions}
            backgroundColor={native.fill}
          />
          {instructionsChanged ? (
            <NativeActionButton
              disabled={pending}
              label={pending ? t("Saving…") : t("Save")}
              onPress={() =>
                void save({
                  instructions: draft,
                  expectedInstructions: doodle.instructions,
                }).then((saved) => {
                  if (saved) setInstructions(null);
                })
              }
              style={{ marginTop: 12 }}
            />
          ) : null}
        </View>
        <Group label={t("Model")}>
          <MenuPicker
            plain
            choices={modelChoices}
            label={t("Model")}
            showLabel={false}
            onChange={selectModel}
            onPress={
              modelChoices.length > MODEL_SEARCH_THRESHOLD
                ? () =>
                    router.push({ pathname: "/doodle-model", params: { value: selectedModelKey } })
                : undefined
            }
            value={selectedModelKey}
          />
          {thinkingOptions.length ? (
            <MenuPicker
              plain
              choices={thinkingChoices}
              label={t("Thinking")}
              onChange={(level) =>
                void save({ thinkingLevel: (level || null) as ThinkingLevel | null })
              }
              value={doodle.thinkingLevel ?? ""}
            />
          ) : null}
        </Group>
        {voices.length ? (
          <Group label={t("Voice")}>
            <MenuPicker
              plain
              choices={[
                { key: "", label: t("Default") },
                ...voices.map((voice) => ({ key: voice.id, label: voice.label })),
              ]}
              label={t("Voice")}
              showLabel={false}
              onChange={(voiceId) => void save({ voiceId: voiceId || null })}
              value={doodle.voiceId ?? ""}
            />
          </Group>
        ) : null}
        <Group label={t("Tools")}>
          {disabledTools.map((name) => (
            <View key={name} style={styles.row}>
              <Text style={[styles.rowLabel, { color: tokens.foreground }]}>{toolLabel(name)}</Text>
              <NativeSwitch
                accessibilityLabel={toolLabel(name)}
                value={false}
                disabled={pending}
                onValueChange={() =>
                  void save({
                    disabledBuiltinTools: disabledTools.filter((entry) => entry !== name),
                  })
                }
              />
            </View>
          ))}
          <MenuPicker
            plain
            label={t("Disable a tool")}
            showLabel={false}
            choices={[
              { key: "", label: t("Disable a tool") },
              ...BUILTIN_TOOL_NAMES.filter((name) => !disabledTools.includes(name)).map((name) => ({
                key: name,
                label: toolLabel(name),
              })),
            ]}
            onChange={(name) => {
              if (name) void save({ disabledBuiltinTools: [...disabledTools, name] });
            }}
            value=""
          />
        </Group>
        {error ? <Text style={{ color: tokens.destructive }}>{error}</Text> : null}
      </ScrollView>
    </>
  );
}

function SectionHeading({ children }: { children: string }) {
  const tokens = useMobileTokens();
  return (
    <Text
      accessibilityRole="header"
      style={[styles.sectionHeading, { color: tokens.mutedForeground }]}
    >
      {children}
    </Text>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <SectionHeading>{label}</SectionHeading>
      <View style={styles.group}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  sectionHeading: { fontSize: 12, fontWeight: "500", flexShrink: 1 },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingEnd: 16,
    marginBottom: 8,
  },
  historyButton: { minHeight: 44, minWidth: 44, alignItems: "flex-end", justifyContent: "center" },
  group: { padding: 16, gap: 12, borderRadius: 12, backgroundColor: native.fill },
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  rowLabel: { fontSize: 14, flex: 1 },
});
