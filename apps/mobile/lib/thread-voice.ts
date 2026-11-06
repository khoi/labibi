import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Alert, AppState } from "react-native";
import type { MobileMessage, MobileSnapshot } from "./api";
import { blockText } from "./api";
import { nextAutoSpeakAction } from "./auto-speak";
import { DOODLE_SPEAKER } from "./doodle";
import { useI18n } from "./i18n";
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
 * Reads Doodle's finished reply aloud when the person has read-aloud on and the chat is in front.
 * Returns a ref to the latest check, for focus effects that must not re-run on every message.
 */
export function useAutoSpeakReply({
  threadId,
  readAloud,
  snap,
  showingSaved,
}: {
  threadId?: string;
  readAloud: boolean;
  snap: MobileSnapshot | null;
  showingSaved: boolean;
}) {
  const navigation = useNavigation();
  const autoSpoken = useRef<string | null>(null);
  const autoSpokenThreadId = useRef<string | null>(null);

  const speakFinishedReply = useCallback(() => {
    if (!threadId || !snap?.chat.doodle) return;
    const decision = nextAutoSpeakAction({
      botId: threadId,
      autoSpeak: readAloud,
      focused: AppState.currentState === "active" && navigation.isFocused(),
      snapshotReady: snap.threadId === threadId && !showingSaved,
      lastSpokenBotId: autoSpokenThreadId.current,
      lastSpokenMessageId: autoSpoken.current,
      runStatus: snap.run?.status,
      messages: snap.messages,
    });
    if (decision.action === "seed") {
      autoSpokenThreadId.current = threadId;
      autoSpoken.current = decision.messageId;
      return;
    }
    if (decision.action !== "speak") return;
    autoSpokenThreadId.current = threadId;
    autoSpoken.current = decision.messageId;
    const botId = snap.messages.find((message) => message.id === decision.messageId)?.botId;
    void speakText(decision.text, { botId, speaker: DOODLE_SPEAKER }).catch(() => undefined);
  }, [
    threadId,
    readAloud,
    navigation,
    showingSaved,
    snap?.chat.doodle,
    snap?.threadId,
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

/** Reads the chat aloud from one message on, each of Doodle's replies in Doodle's voice. */
export function useSpeakMessages({ visibleMessages }: { visibleMessages: MobileMessage[] }) {
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
        return [{ text, botId: candidate.botId, messageId: candidate.id, speaker: DOODLE_SPEAKER }];
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
    [visibleMessages],
  );
}
