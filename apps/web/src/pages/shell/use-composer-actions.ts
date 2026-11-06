import type {
  LoginFieldInput,
  Me,
  MessageReaction,
  ThreadMessage,
  ThreadSnapshot,
} from "@labradoodle/contracts";
import {
  attachmentMaxBytes,
  attachmentMaxCount,
  attachmentSizeLabel,
} from "@labradoodle/contracts";
import type { ComposerMention } from "@labradoodle/core";
import {
  attachmentsForThread,
  inferAttachmentMimeType,
  isImageInputConfirmation,
  newClientId,
  resolveComposerSendPlan,
} from "@labradoodle/core";
import { useLingui } from "@lingui/react/macro";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestBrowserNotificationPermission } from "../../lib/browser-notifications";
import { setComposerUnsavedWork } from "../../lib/composer-draft";
import type { PageSession } from "../../lib/pages";
import {
  readFileAsBase64,
  revokePendingAttachmentPreviews,
  usePendingAttachmentPreviewCleanup,
} from "../../lib/pending-attachments";
import { canPrepareImage, prepareImage } from "../../lib/prepare-image";
import type { createSpaceRpc } from "../../lib/rpc";
import { readSeenRunErrorIds, rememberSeenRunErrorId } from "../../lib/run-error-storage";
import {
  applyThreadSendReceipt,
  clearActiveThreadRuns,
  threadRunError,
} from "../../lib/thread-events";
import { errorText } from "../../lib/user-error";
import type { PendingAttachment } from "./chat-shared";

type ThreadRefresh = RefObject<(id: string) => Promise<ThreadSnapshot>>;

/**
 * What the composer sends and the chat actions beside it: attachments, replies, send, stop,
 * answers, reactions, and the errors they leave.
 */
export function useComposerActions({
  rpc,
  pageSession,
  activeId,
  activeThreadId,
  doodleId,
  userId,
  bootstrapMe,
  activeSnapshot,
  refreshChats,
  refreshThreadRef,
  updateSnapshot,
  terminalRunReceipts,
  clearReadBoundary,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  /** The chat's open page, whose card a message sent from it replies to. */
  pageSession: PageSession;
  activeId: string | undefined;
  activeThreadId: RefObject<string | undefined>;
  /** The workspace's Doodle, which a send's run belongs to. */
  doodleId: string | undefined;
  userId: string | undefined;
  bootstrapMe: Me | null | undefined;
  activeSnapshot: ThreadSnapshot | null;
  refreshChats: () => Promise<void>;
  refreshThreadRef: ThreadRefresh;
  updateSnapshot: (update: (prev: ThreadSnapshot | null) => ThreadSnapshot | null) => void;
  terminalRunReceipts: RefObject<Set<string>>;
  clearReadBoundary: () => void;
}) {
  const { t } = useLingui();
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  usePendingAttachmentPreviewCleanup(pendingAttachments);
  const [replyTarget, setReplyTarget] = useState<ThreadMessage | null>(null);
  const [replyQuote, setReplyQuote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  useEffect(() => {
    setComposerUnsavedWork({ sending, attachments: pendingAttachments.length > 0 });
    return () => setComposerUnsavedWork({ sending: false, attachments: false });
  }, [sending, pendingAttachments.length]);
  const sendingRef = useRef(false);
  const [sendFailure, setSendFailure] = useState<{
    message: string;
    imageConfirmation: boolean;
  } | null>(null);
  // Counts real composer edits so a late rejection cannot confirm a newer draft.
  const draftEdits = useRef(0);
  const clearImageConfirmation = useCallback(() => {
    draftEdits.current += 1;
    setSendFailure((current) => (current?.imageConfirmation ? null : current));
  }, []);
  const imageConfirmation = sendFailure?.imageConfirmation === true;
  const sendError = sendFailure?.message ?? null;
  const setSendError = useCallback((message: string | null) => {
    setSendFailure(message === null ? null : { message, imageConfirmation: false });
  }, []);
  const uploadedSendArtifacts = useRef(new Map<string, WeakMap<File, string>>());
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dismissedRunErrorIds, setDismissedRunErrorIds] =
    useState<ReadonlySet<string>>(readSeenRunErrorIds);

  const activePendingAttachments = useMemo(
    () => attachmentsForThread(pendingAttachments, activeId),
    [activeId, pendingAttachments],
  );
  // Keep the armed reply even when its parent leaves the loaded page: the
  // server resolves a paged-out target and degrades a deleted one to a plain
  // reply instead of failing the send.
  const activeReplyTarget = replyTarget;
  const activeReplyQuote = replyTarget ? replyQuote : null;
  // The armed reply as one value: a newer pick of the same message with a
  // different excerpt is still a newer pick.
  const armedReply = useRef({ target: activeReplyTarget, quote: activeReplyQuote });
  armedReply.current = { target: activeReplyTarget, quote: activeReplyQuote };
  const clearReply = useCallback(() => {
    setReplyTarget(null);
    setReplyQuote(null);
  }, []);
  /** Clears the reply a send carried; one picked while it was in flight stays armed. */
  const clearSentReply = useCallback((sent: ThreadMessage | null, sentQuote: string | null) => {
    if (armedReply.current.target === sent && armedReply.current.quote === sentQuote) {
      setReplyTarget(null);
      setReplyQuote(null);
    }
  }, []);
  const runError = threadRunError(activeSnapshot, dismissedRunErrorIds);
  const displayedRunError = !sendError ? runError : null;
  const displayedRunErrorId = displayedRunError ? (activeSnapshot?.run?.id ?? null) : null;
  const handleRunErrorPresented = useCallback((runId: string) => {
    rememberSeenRunErrorId(runId);
  }, []);

  // Switching chats keeps other chats' pending attachments with their previews;
  // only the open chat's files are shown and sent (activePendingAttachments).
  useEffect(() => {
    clearReply();
    setAttachmentNotice(null);
    setSendError(null);
  }, [activeId, clearReply]);

  const answerMessage = useCallback(
    async (
      message: ThreadMessage,
      text: string,
      fields?: LoginFieldInput[],
      dismiss?: boolean,
      remember?: false,
    ) => {
      const threadId = activeThreadId.current;
      if (!threadId) return;
      clearReadBoundary();
      await rpc.threads.answer({
        threadId,
        runId: message.runId ?? "",
        messageId: message.id,
        answer: text,
        ...(fields ? { fields } : {}),
        ...(remember === false ? { remember } : {}),
        ...(dismiss ? { dismiss: true as const } : {}),
      });
      // The answer is saved; live events can reconcile a failed refresh.
      try {
        if (activeThreadId.current === threadId) await refreshThreadRef.current(threadId);
      } catch {}
    },
    [],
  );
  const reactToMessage = useCallback(
    async (message: ThreadMessage, reaction: MessageReaction) => {
      const threadId = activeThreadId.current;
      if (!threadId) return;
      try {
        const result = await rpc.threads.react({
          threadId,
          messageId: message.id,
          reaction,
          clientNonce: newClientId(),
        });
        if (result.runId) {
          // The reaction is saved; a failed refresh is caught up by live events.
          try {
            if (activeThreadId.current === threadId) await refreshThreadRef.current(threadId);
          } catch {}
        }
      } catch (error) {
        if (activeThreadId.current !== threadId) return;
        setSendError(errorText(error, t`Could not update reaction`));
      }
    },
    [t],
  );
  const onAttachmentPick = useCallback(
    (files: FileList | readonly File[] | null) => {
      const threadKey = activeThreadId.current;
      if (!threadKey || !files?.length) return false;
      const ATTACHMENT_MAX_COUNT = attachmentMaxCount(bootstrapMe);
      const existing = attachmentsForThread(pendingAttachments, threadKey);
      const next: PendingAttachment[] = [];
      const skipped: string[] = [];
      for (const file of Array.from(files)) {
        if (existing.length + next.length >= ATTACHMENT_MAX_COUNT) {
          skipped.push(t`${file.name} (max ${ATTACHMENT_MAX_COUNT} attachments)`);
          continue;
        }
        // Raster photos get a chance to shrink before server-side size validation.
        if (file.size > attachmentMaxBytes(bootstrapMe) && !canPrepareImage(file)) {
          skipped.push(
            t`${file.name} (over ${attachmentSizeLabel(attachmentMaxBytes(bootstrapMe))})`,
          );
          continue;
        }
        const mimeType = inferAttachmentMimeType(file.name, file.type);
        if (!mimeType) {
          skipped.push(file.name);
          continue;
        }
        next.push({
          // A client id, not file metadata: two picks of equal metadata are separate attachments.
          id: newClientId(),
          threadKey,
          file,
          previewUrl: mimeType.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        });
      }
      if (next.length) setPendingAttachments((current) => [...current, ...next]);
      setAttachmentNotice(skipped.length ? t`Skipped ${skipped.join(", ")}` : null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return next.length > 0;
    },
    [pendingAttachments, bootstrapMe, t],
  );
  useEffect(() => {
    if (!pendingAttachments.length) uploadedSendArtifacts.current.clear();
  }, [pendingAttachments]);
  const removeAttachment = useCallback((attachment: PendingAttachment) => {
    revokePendingAttachmentPreviews([attachment]);
    setPendingAttachments((current) => current.filter((item) => item.id !== attachment.id));
  }, []);
  /** A deleted chat's files can never be sent: drop them and release their previews. */
  const discardThreadAttachments = useCallback((threadKey: string) => {
    setPendingAttachments((current) => {
      const discarded = attachmentsForThread(current, threadKey);
      if (!discarded.length) return current;
      revokePendingAttachmentPreviews(discarded);
      return current.filter((attachment) => !discarded.includes(attachment));
    });
  }, []);
  const sendMessage = useCallback(
    async (
      draft: string,
      mentions: ComposerMention[],
      clientNonce: string,
      imageHandling?: "file",
    ) => {
      const threadId = activeThreadId.current;
      if (!threadId || sending) return false;
      const editsAtSend = draftEdits.current;
      // The reply this send carries, read from the ref so a callback that outlived
      // a re-pick of the same message still carries the armed one; a reply picked
      // after this point is for the next message.
      const { target: replyAtSend, quote: replyQuoteAtSend } = armedReply.current;
      const attachments = attachmentsForThread(pendingAttachments, threadId);
      const plan = resolveComposerSendPlan({
        text: draft,
        mentions,
        hasAttachments: attachments.length > 0,
      });
      if (plan.isNoOp) return false;
      if (plan.shouldSend) {
        const permissionRequest = requestBrowserNotificationPermission();
        if (permissionRequest) void permissionRequest.catch(() => undefined);
      }
      // The open page rides only on text this chat sends, never on a routine-only send.
      const fromPage = plan.shouldSend
        ? pageSession.send(plan.trimmed, activeSnapshot?.messages ?? [], replyAtSend?.id)
        : { text: plan.trimmed, replyToMessageId: undefined };
      const trimmed = fromPage.text.trim();
      const replyToMessageId = fromPage.replyToMessageId;
      sendingRef.current = true;
      setSending(true);
      setSendError(null);
      clearReadBoundary();
      setSentCount((count) => count + 1);
      // Keep the draft cleared once the submission is confirmed accepted.
      let accepted = false;
      try {
        if (!plan.shouldSend) {
          if (plan.shouldRunRoutines) {
            await rpc.threads.sendWithRoutines({
              threadId,
              clientNonce,
              routineIds: plan.routineIds,
            });
            accepted = true;
          }
          clearSentReply(replyAtSend, replyQuoteAtSend);
          revokePendingAttachmentPreviews(attachments);
          setPendingAttachments((current) =>
            current.filter((attachment) => !attachments.includes(attachment)),
          );
          setAttachmentNotice(null);
          // The routine is saved; live events reconcile a failed refresh.
          if (activeThreadId.current === threadId) {
            void refreshThreadRef.current(threadId).catch(() => undefined);
          }
          return true;
        }
        const artifactIds: string[] = [];
        const uploaded =
          uploadedSendArtifacts.current.get(clientNonce) ?? new WeakMap<File, string>();
        uploadedSendArtifacts.current.set(clientNonce, uploaded);
        for (const pending of attachments) {
          const existing = uploaded.get(pending.file);
          if (existing) {
            artifactIds.push(existing);
            continue;
          }
          const mimeType = inferAttachmentMimeType(pending.file.name, pending.file.type);
          if (!mimeType) {
            throw new Error(t`Unsupported file type: ${pending.file.name}`);
          }
          const file = await prepareImage(pending.file);
          const contentBase64 = await readFileAsBase64(file);
          // Stable per pending attachment, so a retry under a new send nonce
          // (an edited draft) gets back the artifact this upload already made.
          const uploadNonce = `attachment:${threadId}:${pending.id}`;
          const artifact = await rpc.artifacts.create({
            threadId,
            name: pending.file.name,
            mimeType,
            contentBase64,
            clientNonce: uploadNonce,
          });
          uploaded.set(pending.file, artifact.id);
          artifactIds.push(artifact.id);
        }
        const payload = {
          threadId,
          clientNonce,
          imageHandling: imageHandling ?? "confirm",
          text: trimmed || undefined,
          mentions: plan.mentionPayload.length ? plan.mentionPayload : undefined,
          artifactIds: artifactIds.length ? artifactIds : undefined,
          replyToMessageId: replyToMessageId ?? replyAtSend?.id,
          replyQuote: replyToMessageId ? undefined : (replyQuoteAtSend ?? undefined),
          fromPage: replyToMessageId ? true : undefined,
        } as const;
        // The routines run in the same server operation as the message: both or neither.
        const sent = plan.shouldRunRoutines
          ? (await rpc.threads.sendWithRoutines({ ...payload, routineIds: plan.routineIds })).send
          : await rpc.threads.send(payload);
        accepted = true;
        if (sent?.runId && sent.taskId && doodleId && activeThreadId.current === threadId) {
          const runId = sent.runId;
          const taskId = sent.taskId;
          updateSnapshot((current) =>
            applyThreadSendReceipt(
              current,
              { threadId, botId: doodleId, userId, runId, taskId },
              terminalRunReceipts.current,
            ),
          );
        }
        uploadedSendArtifacts.current.delete(clientNonce);
        clearSentReply(replyAtSend, replyQuoteAtSend);
        revokePendingAttachmentPreviews(attachments);
        // Keep files picked while this send was in flight.
        setPendingAttachments((current) =>
          current.filter((attachment) => !attachments.includes(attachment)),
        );
        void refreshChats().catch(() => undefined);
        if (activeThreadId.current === threadId) setAttachmentNotice(null);
        void refreshThreadRef.current(threadId).catch(() => undefined);
        return true;
      } catch (error) {
        const isConfirmation = isImageInputConfirmation(error);
        // Offer the file resend only for the unchanged draft this send carried.
        const confirmation = isConfirmation && draftEdits.current === editsAtSend;
        if (activeThreadId.current === threadId) {
          setSendFailure({
            message: errorText(error, t`Failed to send message`),
            imageConfirmation: confirmation,
          });
        }
        return isConfirmation ? false : accepted;
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [
      activeSnapshot?.messages,
      pageSession,
      clearSentReply,
      doodleId,
      pendingAttachments,
      sending,
      t,
      userId,
    ],
  );
  const stopRun = useCallback(async () => {
    if (sending) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const threadId = activeThreadId.current;
      if (!threadId) return;
      setSendError(null);
      try {
        await rpc.threads.stop({ threadId });
      } catch (error) {
        if (activeThreadId.current === threadId) setSendError(errorText(error, t`Failed to stop`));
        return;
      }
      // Clear local run state immediately rather than waiting for run.cancelled so a
      // superseded in-flight refresh (older cursor) cannot leave Stop enabled while the
      // API is already idle.
      if (activeThreadId.current === threadId) {
        updateSnapshot((prev) =>
          prev && prev.threadId === threadId ? clearActiveThreadRuns(prev) : prev,
        );
      }
      await refreshThreadRef.current(threadId).catch(() => undefined);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [sending, t]);

  function dismissComposerError() {
    // The strip shows one message at a time, so only dismiss the run failure when it is the
    // one on screen; otherwise a live run would be silenced before it has even failed.
    const failedRunId = displayedRunErrorId;
    setSendError(null);
    if (failedRunId) {
      rememberSeenRunErrorId(failedRunId);
      setDismissedRunErrorIds((current) => new Set(current).add(failedRunId));
    }
  }

  return {
    activePendingAttachments,
    attachmentNotice,
    fileInputRef,
    onAttachmentPick,
    removeAttachment,
    discardThreadAttachments,
    replyTarget: activeReplyTarget,
    replyQuote: activeReplyQuote,
    setReplyTarget,
    setReplyQuote,
    clearReply,
    sending,
    sentCount,
    sendMessage,
    stopRun,
    answerMessage,
    reactToMessage,
    sendError,
    setSendError,
    imageConfirmation,
    clearImageConfirmation,
    dismissedRunErrorIds,
    displayedRunError,
    displayedRunErrorId,
    handleRunErrorPresented,
    dismissComposerError,
  };
}
