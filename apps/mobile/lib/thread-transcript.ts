import { projectMessageReactions, shouldShowBotSenderName } from "@labradoodle/core";
import { useMemo, useState } from "react";
import type { MobileMessage } from "./api";
import { applyLocalChoiceDismissals, hasVisibleMessagePresentation } from "./message-presentation";

/**
 * What the chat draws from its messages: reactions folded into the message they belong to, and
 * choices the user dismissed here hidden.
 */
export function useThreadTranscript(messages: MobileMessage[] | undefined, inGroup: boolean) {
  const [dismissedChoiceQuestions, setDismissedChoiceQuestions] = useState<
    ReadonlyMap<string, ReadonlySet<string>>
  >(() => new Map());
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
        (messages ?? [])
          .map((message) => {
            const dismissed = dismissedChoiceQuestions.get(message.id);
            if (!dismissed) return message;
            const blocks = applyLocalChoiceDismissals(message.blocks, dismissed);
            return blocks === message.blocks ? message : { ...message, blocks: [...blocks] };
          })
          .filter((message) => hasVisibleMessagePresentation(message.blocks)),
      ),
    [dismissedChoiceQuestions, messages],
  );

  function dismissChoice(messageId: string, question: string) {
    setDismissedChoiceQuestions((current) => {
      const existing = current.get(messageId);
      if (existing?.has(question)) return current;
      const next = new Map(current);
      const questions = new Set(existing);
      questions.add(question);
      next.set(messageId, questions);
      return next;
    });
  }

  return {
    showBotSenderName,
    reactionView,
    dismissChoice,
    visibleMessages: reactionView.visibleMessages,
  };
}
