import { CHAT_NAME_MAX_LENGTH } from "@labradoodle/contracts";
import { accountDisplay, DOODLE_NAME } from "@labradoodle/core";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, View } from "react-native";
import { PersonAvatar } from "../components/chat-avatar";
import { DoodleAvatar } from "../components/doodle-avatar";
import { glassHeaderOptions } from "../components/glass-title";
import { NativeSwitch } from "../components/native-switch";
import { useTextEditDialog } from "../components/profile-edit-dialog";
import { SettingsGroup, SettingsRow } from "../components/settings-group";
import { currentApiBase, loadSessionToken, rpc, selectedSpaceId } from "../lib/api";
import { confirmClearConversation, confirmEndChat } from "../lib/chat-lifecycle";
import { useChat } from "../lib/chat-store";
import { useI18n } from "../lib/i18n";
import { afterChatNotifyChange } from "../lib/live-notifications";
import { native, useMobileTokens } from "../lib/native";
import { useSideInsets } from "../lib/side-insets";
import { errorText } from "../lib/user-error";
import { loadWorkspacePeople } from "../lib/workspace-people";

/**
 * A chat's settings: who is in it, Doodle, its name, notifications, its files, memory and
 * routines, and leaving it (deleting it when no one else is in it).
 */
export default function ChatSettings() {
  const sideInsets = useSideInsets();
  const tokens = useMobileTokens();
  const { t } = useI18n();
  const router = useRouter();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const { chat, error, setError, reload, changed } = useChat(threadId);
  const [me, setMe] = useState<string | null>(null);
  const [workspacePeople, setWorkspacePeople] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const rename = useTextEditDialog(t("Name"), CHAT_NAME_MAX_LENGTH);

  // People added on the add-people sheet show when it closes.
  useFocusEffect(
    useCallback(() => {
      void reload();
      void rpc("me")
        .then((next) => setMe(next.userId))
        .catch(() => undefined);
      void loadWorkspacePeople()
        .then((people) => setWorkspacePeople(people.map((person) => person.userId)))
        .catch(() => undefined);
    }, [reload]),
  );

  async function change(run: () => Promise<Parameters<typeof changed>[0]>) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      changed(await run());
    } catch (err) {
      Alert.alert(t("Could not update chat"), errorText(err, t("Try again.")));
    } finally {
      setPending(false);
    }
  }

  if (!chat || !threadId) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Stack.Screen options={glassHeaderOptions(t("Chat settings"))} />
        {error ? (
          <Text style={{ color: tokens.destructive }}>{error}</Text>
        ) : (
          <ActivityIndicator color={native.secondaryLabel} />
        )}
      </View>
    );
  }
  const solo = chat.members.every((member) => member.userId === me);
  // Only offered while someone of the workspace is not in the chat yet.
  const canAdd = workspacePeople.some(
    (userId) => !chat.members.some((member) => member.userId === userId),
  );
  const open = (pathname: "/artifacts" | "/pages" | "/memory" | "/routines") =>
    router.push({ pathname, params: { threadId } });

  return (
    <>
      <Stack.Screen options={glassHeaderOptions(t("Chat settings"))} />
      <ScrollView
        style={[{ flex: 1, backgroundColor: native.groupedPage }, sideInsets]}
        contentContainerStyle={{ padding: 16, gap: 24 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <SettingsGroup>
          {chat.members.map((member) => (
            <SettingsRow
              key={member.userId}
              title={member.userId === me ? t("You") : accountDisplay(member, t("Member")).label}
              leading={<PersonAvatar person={member} size={32} />}
            />
          ))}
          {canAdd ? (
            <SettingsRow
              key="add"
              accessibilityRole="button"
              disabled={pending}
              title={t("Add people")}
              tinted
              onPress={() => router.push({ pathname: "/add-people", params: { threadId } })}
            />
          ) : null}
        </SettingsGroup>
        <SettingsGroup>
          <SettingsRow
            title={DOODLE_NAME}
            leading={<DoodleAvatar identity={threadId} size={32} status={chat.status} />}
            trailing={
              <NativeSwitch
                accessibilityLabel={DOODLE_NAME}
                value={chat.doodle}
                disabled={pending}
                onValueChange={(doodle) =>
                  void change(() => rpc("threads/setDoodle", { threadId, doodle }))
                }
              />
            }
          />
        </SettingsGroup>
        <SettingsGroup>
          <SettingsRow
            accessibilityRole="button"
            disabled={pending}
            title={t("Name")}
            value={chat.name ?? ""}
            chevron="right"
            onPress={() =>
              rename.ask(chat.name ?? "", (name) => {
                if (name === (chat.name ?? "")) return;
                void change(() => rpc("threads/rename", { threadId, name: name || null }));
              })
            }
          />
          <SettingsRow
            title={t("Notifications")}
            trailing={
              <NativeSwitch
                accessibilityLabel={t("Notifications")}
                value={!chat.muted}
                disabled={pending}
                onValueChange={(notify) =>
                  void change(async () => {
                    await rpc("threads/setMuted", { threadId, muted: !notify });
                    await afterChatNotifyChange(
                      currentApiBase(),
                      await loadSessionToken(),
                      selectedSpaceId() ?? "",
                      { threadId, notify },
                    );
                    return { ...chat, muted: !notify };
                  })
                }
              />
            }
          />
        </SettingsGroup>
        <SettingsGroup>
          <SettingsRow
            accessibilityRole="button"
            title={t("Files")}
            chevron="right"
            onPress={() => open("/artifacts")}
          />
          <SettingsRow
            accessibilityRole="button"
            title={t("Pages")}
            chevron="right"
            onPress={() => open("/pages")}
          />
          <SettingsRow
            accessibilityRole="button"
            title={t("Memory")}
            chevron="right"
            onPress={() => open("/memory")}
          />
          {chat.doodle ? (
            <SettingsRow
              accessibilityRole="button"
              title={t("Routines")}
              chevron="right"
              onPress={() => open("/routines")}
            />
          ) : null}
        </SettingsGroup>
        <SettingsGroup>
          {solo ? (
            <SettingsRow
              accessibilityRole="button"
              destructive
              title={t("Clear conversation")}
              onPress={() => confirmClearConversation(threadId, () => router.back())}
            />
          ) : null}
          <SettingsRow
            accessibilityRole="button"
            destructive
            title={solo ? t("Delete chat") : t("Leave chat")}
            onPress={() =>
              confirmEndChat(chat, solo ? "delete" : "leave", () => router.dismissTo("/"))
            }
          />
        </SettingsGroup>
      </ScrollView>
      {rename.dialog}
    </>
  );
}
