import type { LoginFieldInput, MessageReaction } from "@labradoodle/contracts";
import type { SlashActionId } from "@labradoodle/core";
import {
  attachmentsForThread,
  newClientId,
  pageReply,
  resolveComposerSendPlan,
} from "@labradoodle/core";
import { useNavigation, useRouter } from "expo-router";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import type { ThreadComposerHandle } from "../components/thread-composer";
import type { MobileMessage, MobileSnapshot } from "./api";
import { currentApiBase, loadSessionToken, rpc, selectedSpaceId } from "./api";
import { subscribeComposerOffer } from "./composer-offer";
import { useI18n } from "./i18n";
import { resumeLiveNotifications } from "./live-notifications";
import { takePageReply } from "./pages";
import { currentSessionGeneration } from "./session";
import { answerThreadMessage } from "./thread-answer";
import type { useThreadAttachments } from "./thread-attachments";
import type { SendAttempt, useThreadFeedback } from "./thread-feedback";
import { subscribeDelivered } from "./thread-feedback";
import type { ThreadHistory } from "./thread-history";
import type { ThreadListScroll } from "./thread-list-scroll";
import { previewMessageText } from "./thread-message-text";
import { prepareUnsentSends } from "./unsent-sends";
import { errorText } from "./user-error";

/**
 * What the chat sends: composer messages with their reply and attachments, retries, stopping
 * work, ask answers and reactions, and slash actions.
 */
export function useThreadSend({
  threadId,
  readOnly,
  history,
  scroll,
  feedback,
  attachments,
  activeThreadId,
  isCurrentTarget,
  refresh,
  showLatest,
  markCaughtUp,
}: {
  threadId?: string;
  readOnly: boolean;
  history: ThreadHistory;
  scroll: ThreadListScroll;
  feedback: ReturnType<typeof useThreadFeedback>;
  attachments: ReturnType<typeof useThreadAttachments>;
  activeThreadId: RefObject<string | undefined>;
  isCurrentTarget: (threadId: string | undefined) => boolean;
  refresh: () => Promise<MobileSnapshot | undefined>;
  showLatest: () => void;
  /** Clears the "New" divider: the user has caught up. */
  markCaughtUp: () => void;
}) {
  const threadKey = threadId;
  const { t } = useI18n();
  const router = useRouter();
  const navigation = useNavigation();
  const { pendingAttachments, setPendingAttachments, setAttachmentNotice, importingShare } =
    attachments;
  const { setError } = feedback;
  const composerRef = useRef<ThreadComposerHandle>(null);
  const [replyTarget, setReplyTarget] = useState<MobileMessage | null>(null);
  const [replyQuote, setReplyQuote] = useState<string | null>(null);
  const [quoteTarget, setQuoteTarget] = useState<MobileMessage | null>(null);
  const replyPage = useRef<{ id: string; title: string } | null>(null);
  const [sending, setSending] = useState(false);
  const preparingSend = useRef(false);

  useEffect(() => {
    setPendingAttachments((current) => attachmentsForThread(current, threadKey));
    setReplyTarget(null);
    setReplyQuote(null);
    setQuoteTarget(null);
    replyPage.current = null;
    setAttachmentNotice(null);
    setError(null);
  }, [threadKey]);

  /** A reply tapped on one of this chat's pages lands in the composer unsent, about that page. */
  const receivePageReply = useCallback(() => {
    const handle = composerRef.current;
    const reply = handle ? takePageReply(threadKey) : null;
    if (!handle || !reply) return;
    handle.addReply(reply.text);
    // The page is what it answers now, not a message picked before the page opened.
    setReplyTarget(null);
    setReplyQuote(null);
    replyPage.current = reply.page;
  }, [threadKey]);
  // An app card in this chat offers its text straight into the open composer.
  useEffect(
    () =>
      threadKey
        ? subscribeComposerOffer(threadKey, (text) => composerRef.current?.addReply(text))
        : undefined,
    [threadKey],
  );
  const composerEmptied = useCallback(() => {
    replyPage.current = null;
  }, []);

  function runSlashAction(action: SlashActionId) {
    if (action === "chat-settings") {
      if (threadId) router.push({ pathname: "/chat-settings", params: { threadId } });
      return;
    }
    router.push({
      pathname: "/account",
      params: action === "settings-usage" ? { focus: "usage" } : undefined,
    });
  }

  function followOwnSend() {
    // Writing in the chat means the user has caught up, so the "New" divider goes.
    markCaughtUp();
    if (history.pinnedAroundRef.current || history.jumpScrollTarget.current) showLatest();
    scroll.follow(scroll.behavior.current.onOwnSend());
  }

  async function send() {
    if (readOnly || importingShare.current) return;
    const originThreadKey = threadId;
    if (!originThreadKey || sending || preparingSend.current) return;
    const submitted = composerRef.current?.snapshot();
    if (!submitted) return;
    const attachments = attachmentsForThread(pendingAttachments, originThreadKey);
    const plan = resolveComposerSendPlan({
      text: submitted.promptText,
      mentions: submitted.mentions,
      hasAttachments: attachments.length > 0,
    });
    if (plan.isNoOp) return;
    preparingSend.current = true;
    try {
      await prepareUnsentSends();
    } catch (error) {
      Alert.alert(t("Failed to send message"), errorText(error));
      return;
    } finally {
      preparingSend.current = false;
    }
    if (
      !isCurrentTarget(originThreadKey) ||
      JSON.stringify(submitted) !== JSON.stringify(composerRef.current?.snapshot())
    )
      return;
    // As on the web: a page's reply goes to its card here, or names the page when none is loaded.
    const messages = history.snapRef.current?.messages ?? [];
    const fromPage = plan.shouldSend
      ? pageReply(plan.trimmed, messages, replyPage.current, replyTarget?.id)
      : { text: plan.trimmed };
    const pageCard = messages.find((message) => message.id === fromPage.replyToMessageId);
    let attempt: SendAttempt;
    try {
      attempt = feedback.sendAttempt({
        originThreadKey,
        displayText: fromPage.text === plan.trimmed ? submitted.promptText : fromPage.text,
        replyPreview: pageCard
          ? previewMessageText(pageCard)
          : (replyQuote ?? (replyTarget ? previewMessageText(replyTarget) : null)),
        plan: { ...plan, trimmed: fromPage.text },
        attachments,
        replyTargetId: pageCard?.id ?? replyTarget?.id,
        replyQuote: pageCard ? null : replyQuote,
        fromPage: pageCard ? true : undefined,
      });
    } catch (error) {
      Alert.alert(t("Failed to send message"), errorText(error));
      return;
    }
    composerRef.current?.reset();
    setPendingAttachments((current) =>
      current.filter((attachment) => !submitted.attachmentIds.includes(attachment.id)),
    );
    setReplyTarget(null);
    setReplyQuote(null);
    replyPage.current = null;
    setAttachmentNotice(null);
    followOwnSend();
    await deliver(attempt);
  }

  async function deliver(attempt: SendAttempt, force = false) {
    if (!readOnly) await feedback.send(attempt, force);
  }

  function retry(attempt: SendAttempt) {
    followOwnSend();
    void deliver(attempt, true);
  }

  function afterDelivered(attempt: SendAttempt) {
    const generation = currentSessionGeneration();
    const apiBase = currentApiBase();
    const spaceId = selectedSpaceId();
    void loadSessionToken()
      .then((token) => {
        if (
          generation === currentSessionGeneration() &&
          apiBase === currentApiBase() &&
          spaceId === selectedSpaceId()
        )
          return resumeLiveNotifications(apiBase, token, spaceId ?? "");
      })
      .catch(() => undefined);
    if (attempt.payload.originThreadKey !== activeThreadId.current || !navigation.isFocused())
      return;
    if (isCurrentTarget(attempt.payload.originThreadKey)) {
      if (history.pinnedAroundRef.current) showLatest();
      void refresh().catch(() => undefined);
    }
  }

  const afterDeliveredRef = useRef(afterDelivered);
  afterDeliveredRef.current = afterDelivered;
  useEffect(() => subscribeDelivered((attempt) => afterDeliveredRef.current(attempt)), []);

  async function stop() {
    if (readOnly) return;
    const target = threadId;
    if (!target || sending) return;
    setSending(true);
    try {
      await rpc("threads/stop", { threadId: target });
    } catch (err) {
      if (isCurrentTarget(target)) {
        Alert.alert(t("Failed to stop work"), errorText(err, t("Try again.")));
      }
      setSending(false);
      return;
    }
    try {
      await refresh();
    } catch (err) {
      if (isCurrentTarget(target)) {
        const detail = errorText(err, t("Failed to refresh"));
        setError(t("Work stopped, but the thread could not refresh: {detail}", { detail }));
      }
    } finally {
      setSending(false);
    }
  }

  const answer = useCallback(
    (
      message: MobileMessage,
      answer: string,
      fields?: readonly LoginFieldInput[],
      dismiss?: boolean,
      remember?: false,
    ) =>
      answerThreadMessage(
        { threadId, readOnly, rpc, isCurrentTarget, refresh, markRead: markCaughtUp },
        message,
        answer,
        fields,
        dismiss,
        remember,
      ),
    [threadId, readOnly],
  );

  async function react(message: MobileMessage, reaction: MessageReaction) {
    if (readOnly) return false;
    const target = threadId;
    if (!target) return false;
    try {
      const result = await rpc("threads/react", {
        threadId: target,
        messageId: message.id,
        reaction,
        clientNonce: newClientId(),
      });
      if (result.runId && isCurrentTarget(target)) {
        // The reaction is saved; a failed refresh is caught up by live events.
        await refresh().catch(() => {});
      }
      return true;
    } catch (err) {
      if (!isCurrentTarget(target)) return false;
      Alert.alert(t("Could not update reaction"), errorText(err, t("Try again.")));
      return false;
    }
  }

  return {
    composerRef,
    replyTarget,
    setReplyTarget,
    replyQuote,
    setReplyQuote,
    quoteTarget,
    setQuoteTarget,
    receivePageReply,
    composerEmptied,
    sending,
    send,
    retry,
    stop,
    answer,
    react,
    runSlashAction,
  };
}
