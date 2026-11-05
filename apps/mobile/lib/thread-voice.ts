import { memberName, resolvePersonaColorDef } from "@labradoodle/core";
import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Alert, AppState } from "react-native";
import type { MobileBot, MobileMessage, MobileSnapshot } from "./api";
import { blockText } from "./api";
import { nextAutoSpeakAction } from "./auto-speak";
import { useI18n } from "./i18n";
import { speakerColorFor } from "./thread-message-text";
import { errorText } from "./user-error";
import { speakQueue, speakText } from "./voice";

const ATTACHMENT_PLACEHOLDER_LINE = /^\[(?:image|file|chart): .*\]$/;

function speakableMessageText(message: MobileMessage): string {
  return blockText(message)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !ATTACHMENT_PLACEHOLDER_LINE.test(line))
    .join("\n");
}

/**
 * Reads a bot's finished reply aloud when the bot has auto-speak on and its chat is in front.
 * Returns a ref to the latest check, for focus effects that must not re-run on every message.
 */
export function useAutoSpeakReply({
  botId,
  inGroup,
  currentBot,
  snap,
  showingSaved,
}: {
  botId?: string;
  inGroup: boolean;
  currentBot?: MobileBot;
  snap: MobileSnapshot | null;
  showingSaved: boolean;
}) {
  const navigation = useNavigation();
  const autoSpoken = useRef<string | null>(null);
  const autoSpokenBotId = useRef<string | null>(null);

  const speakFinishedReply = useCallback(() => {
    if (!botId || inGroup || !currentBot) return;
    const decision = nextAutoSpeakAction({
      botId: currentBot.id,
      autoSpeak: currentBot.autoSpeak,
      focused: AppState.currentState === "active" && navigation.isFocused(),
      snapshotReady: snap?.botId === currentBot.id && !showingSaved,
      lastSpokenBotId: autoSpokenBotId.current,
      lastSpokenMessageId: autoSpoken.current,
      runStatus: snap?.run?.status,
      messages: snap?.messages ?? [],
    });
    if (decision.action === "seed") {
      autoSpokenBotId.current = currentBot.id;
      autoSpoken.current = decision.messageId;
      return;
    }
    if (decision.action !== "speak") return;
    autoSpokenBotId.current = currentBot.id;
    autoSpoken.current = decision.messageId;
    void speakText(decision.text, {
      botId: currentBot.id,
      speaker: {
        name: currentBot.name,
        color: resolvePersonaColorDef(currentBot.id, currentBot.color).hex,
      },
    }).catch(() => undefined);
  }, [
    botId,
    inGroup,
    currentBot,
    navigation,
    showingSaved,
    snap?.botId,
    snap?.messages,
    snap?.run?.status,
  ]);

  const speakFinishedReplyRef = useRef(speakFinishedReply);
  useLayoutEffect(() => {
    speakFinishedReplyRef.current = speakFinishedReply;
  }, [speakFinishedReply]);

  useEffect(() => {
    speakFinishedReply();
    const appState = AppState.addEventListener("change", speakFinishedReply);
    return () => appState.remove();
  }, [speakFinishedReply]);

  return speakFinishedReplyRef;
}

/** Reads the chat aloud from one message on, each bot reply in its speaker's voice. */
export function useSpeakMessages({
  visibleMessages,
  botId,
  members,
  displayName,
  mentionBots,
}: {
  visibleMessages: MobileMessage[];
  botId?: string;
  members: MobileSnapshot["members"] | undefined;
  displayName?: string;
  mentionBots: MobileBot[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  return useCallback(
    (message: MobileMessage) => {
      const startIndex = visibleMessages.findIndex((candidate) => candidate.id === message.id);
      const fromHere = startIndex === -1 ? [message] : visibleMessages.slice(startIndex);
      const items = fromHere.flatMap((candidate) => {
        if (candidate.role !== "bot") return [];
        const text = speakableMessageText(candidate);
        if (!text) return [];
        const speakerBotId = candidate.botId ?? botId ?? members?.[0]?.botId ?? "";
        return [
          {
            text,
            botId: speakerBotId,
            messageId: candidate.id,
            speaker: {
              name: memberName(members, speakerBotId) ?? displayName,
              color: speakerColorFor(mentionBots, members, speakerBotId),
            },
          },
        ];
      });
      if (items.length === 0) return;
      void speakQueue(items)
        .then((spoken) => {
          if (!spoken)
            Alert.alert(t("Could not speak"), t("Add a voice provider in Voice settings."), [
              { text: t("Cancel"), style: "cancel" },
              { text: t("Open Voice"), onPress: () => router.push("/voice") },
            ]);
        })
        .catch((err: unknown) =>
          Alert.alert(t("Could not speak"), errorText(err, t("Try again."))),
        );
    },
    [botId, displayName, mentionBots, members, visibleMessages],
  );
}
