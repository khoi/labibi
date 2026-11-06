import type { SpaceMember } from "@labradoodle/contracts";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { PeoplePicker } from "../components/people-picker";
import { cancelHeaderOptions, trailingHeaderOptions } from "../components/sheet-header";
import { rpc } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { native, useMobileTokens } from "../lib/native";
import { addToSearchInbox } from "../lib/search-inbox";
import { useSideInsets } from "../lib/side-insets";
import { errorText } from "../lib/user-error";
import { loadWorkspacePeople } from "../lib/workspace-people";

/** Adds people of the workspace to a chat; they see its whole history. */
export default function AddPeople() {
  const sideInsets = useSideInsets();
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const router = useRouter();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const [people, setPeople] = useState<SpaceMember[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!threadId) return;
    let active = true;
    void Promise.all([loadWorkspacePeople(), rpc("threads/members", { threadId })])
      .then(([workspace, members]) => {
        if (!active) return;
        const inChat = new Set(members.map((member) => member.userId));
        setPeople(workspace.filter((person) => !inChat.has(person.userId)));
      })
      .catch((err: unknown) => {
        if (!active) return;
        setPeople([]);
        setError(errorText(err, t("Could not load members")));
      });
    return () => {
      active = false;
    };
  }, [threadId, t]);

  async function add() {
    if (!threadId || pending || selected.length === 0) return;
    setPending(true);
    setError(null);
    try {
      addToSearchInbox(await rpc("threads/addMembers", { threadId, userIds: selected }));
      router.back();
    } catch (err) {
      setError(errorText(err, t("Could not update chat")));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: t("Add people"),
          ...cancelHeaderOptions(t("Cancel"), () => router.back()),
          ...trailingHeaderOptions(t("Add"), () => void add(), pending || selected.length === 0),
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={[{ flex: 1, backgroundColor: native.groupedPage }, sideInsets]}
        contentContainerStyle={{ padding: 16, gap: 24 }}
      >
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
