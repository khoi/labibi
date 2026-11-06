import type { SpaceMember } from "@labradoodle/contracts";
import { CHAT_NAME_MAX_LENGTH } from "@labradoodle/contracts";
import { DOODLE_NAME } from "@labradoodle/core";
import { Stack, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { DoodleAvatar } from "../components/doodle-avatar";
import { NativeSwitch } from "../components/native-switch";
import { PeoplePicker } from "../components/people-picker";
import { SettingsGroup, SettingsInputRow, SettingsRow } from "../components/settings-group";
import { cancelHeaderOptions, trailingHeaderOptions } from "../components/sheet-header";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { native, useMobileTokens } from "../lib/native";
import { addToSearchInbox } from "../lib/search-inbox";
import { useSideInsets } from "../lib/side-insets";
import { errorText } from "../lib/user-error";
import { loadWorkspacePeople } from "../lib/workspace-people";

/** Picks who is in a new chat: Doodle (off until turned on) and people of the workspace. */
export default function NewChat() {
  const sideInsets = useSideInsets();
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const router = useRouter();
  const [people, setPeople] = useState<SpaceMember[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [doodle, setDoodle] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const creating = useRef(false);
  // A name only helps once there are two or more other people to tell the chat apart by.
  const named = selected.length >= 2;

  useEffect(() => {
    let active = true;
    void loadWorkspacePeople()
      .then((next) => {
        if (active) setPeople(next);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setPeople([]);
        setError(errorText(err, t("Could not load members")));
      });
    return () => {
      active = false;
    };
  }, [t]);

  function close() {
    if (router.canDismiss()) router.dismiss();
    else if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  async function start() {
    if (creating.current) return;
    creating.current = true;
    setPending(true);
    setError(null);
    try {
      const chat = await rpc("threads/create", {
        userIds: selected,
        doodle,
        ...(named && name.trim() ? { name: name.trim() } : {}),
      });
      addToSearchInbox(chat);
      router.replace({ pathname: "/thread", params: { threadId: chat.id } });
    } catch (err) {
      setError(errorText(err, t("Could not start chat")));
    } finally {
      creating.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: t("New chat"),
          ...cancelHeaderOptions(t("Cancel"), close),
          ...trailingHeaderOptions(t("Start chat"), () => void start(), pending),
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={[{ flex: 1, backgroundColor: native.groupedPage }, sideInsets]}
        contentContainerStyle={{ padding: 16, gap: 24 }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        <SettingsGroup>
          <SettingsRow
            title={DOODLE_NAME}
            leading={<DoodleAvatar size={32} />}
            trailing={
              <NativeSwitch
                accessibilityLabel={DOODLE_NAME}
                value={doodle}
                disabled={pending}
                onValueChange={setDoodle}
              />
            }
          />
        </SettingsGroup>
        {named ? (
          <SettingsGroup>
            <SettingsInputRow
              accessibilityLabel={t("Name")}
              placeholder={t("Name")}
              value={name}
              onChangeText={setName}
              maxLength={CHAT_NAME_MAX_LENGTH}
              editable={!pending}
              autoCapitalize="words"
              returnKeyType="done"
            />
          </SettingsGroup>
        ) : null}
        {people === null ? (
          <View style={{ paddingTop: 24 }}>
            <ActivityIndicator color={native.secondaryLabel} />
          </View>
        ) : (
          <PeoplePicker
            people={people}
            selected={selected}
            onChange={setSelected}
            disabled={pending}
          />
        )}
        {error ? <Text style={{ color: tokens.destructive }}>{error}</Text> : null}
      </ScrollView>
    </>
  );
}
