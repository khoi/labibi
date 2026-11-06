import { projectMessageReactions, shouldShowBotSenderName } from "@labradoodle/core";
import { useMemo } from "react";
import type { MobileMessage } from "./api";
import { hasVisibleMessagePresentation } from "./message-presentation";

/** What the chat draws from its messages: reactions folded into the message they belong to. */
export function useThreadTranscript(messages: MobileMessage[] | undefined, inGroup: boolean) {
  const showBotSenderName = useMemo(
    () =>
      shouldShowBotSenderName({
        isGroup: inGroup,
        speakerBotIds: (messages ?? [])
          .filter((message) => message.role === "bot")
          .map((message) => message.botId),
      }),
    [inGroup, messages],
  );
  const reactionView = useMemo(
    () =>
      projectMessageReactions(
        (messages ?? []).filter((message) => hasVisibleMessagePresentation(message.blocks)),
      ),
    [messages],
  );

  return {
    showBotSenderName,
    reactionView,
    visibleMessages: reactionView.visibleMessages,
  };
}
