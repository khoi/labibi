import type { ThreadMessage, ThreadSnapshot } from "@labradoodle/contracts";
import { speechFromBlocks } from "@labradoodle/core";
import { toast } from "@labradoodle/ui-web";
import { useCallback, useEffect, useRef, useState } from "react";
import { speaker } from "../../lib/tts";

const READ_ALOUD_TOAST = "read-aloud-error";

/** Chat read-aloud has no caption to carry a failure, so it surfaces as a toast. */
function readAloud(text: string, opts: { voiceId?: string; messageId: string }) {
  void speaker.speak(text, opts).then((error) => {
    if (error) toast.error(error, { id: READ_ALOUD_TOAST });
  });
}

/** Reads Doodle's replies aloud: on request, and as they arrive when the person turned it on. */
export function useReadAloud({
  threadId,
  snapshot,
  enabled,
  voiceId,
}: {
  threadId: string | undefined;
  snapshot: ThreadSnapshot | null;
  enabled: boolean;
  voiceId: string | null | undefined;
}) {
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const autoSpoken = useRef<string | null>(null);
  const autoSpokenThreadId = useRef<string | null>(null);
  const voice = voiceId || undefined;

  useEffect(
    () =>
      speaker.subscribe((state) => {
        setSpeakingMessageId(state.status === "idle" ? null : (state.messageId ?? null));
      }),
    [],
  );

  useEffect(() => {
    if (!threadId || !snapshot || snapshot.threadId !== threadId) return;
    const lastBot = [...snapshot.messages].reverse().find((message) => message.role === "bot");
    if (autoSpokenThreadId.current !== threadId || !enabled) {
      autoSpokenThreadId.current = threadId;
      autoSpoken.current = lastBot?.id ?? null;
      return;
    }
    if (snapshot.run && ["running", "queued", "leased"].includes(snapshot.run.status)) return;
    if (!lastBot || lastBot.id === autoSpoken.current) return;
    const text = speechFromBlocks(lastBot.blocks);
    if (!text) return;
    autoSpoken.current = lastBot.id;
    readAloud(text, { voiceId: voice, messageId: lastBot.id });
  }, [snapshot?.messages, snapshot?.run?.status, snapshot?.threadId, enabled, threadId, voice]);

  const speakingMessageIdRef = useRef(speakingMessageId);
  speakingMessageIdRef.current = speakingMessageId;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const speakMessage = useCallback((message: ThreadMessage) => {
    if (speakingMessageIdRef.current === message.id) {
      speaker.stop();
      return;
    }
    const text = speechFromBlocks(message.blocks);
    if (text) readAloud(text, { voiceId: voiceRef.current, messageId: message.id });
  }, []);

  return { speakingMessageId, speakMessage };
}
