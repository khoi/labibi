import {
  answerableAskMessageIds,
  DOODLE_NAME,
  dismissableAskMessageIds,
  otherAuthor,
  timeSeparatorIds,
  unreadDividerMessageId,
} from "@labradoodle/core";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { ListRenderItemInfo } from "react-native";
import type { MobileMessage, MobileSnapshot } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import type { UserMentionTarget } from "../../lib/message-mentions";
import { threadHeaderFloats } from "../../lib/thread-edges";
import { previewMessageText } from "../../lib/thread-message-text";
import type { useThreadTranscript } from "../../lib/thread-transcript";
import type { UserBubble } from "../../lib/user-bubble";
import type { MessageRowActions } from "./message-row";
import { MessageRow } from "./message-row";

/** Stable row actions that call the latest screen actions, so settled rows don't re-render. */
export function useLatestRowActions(current: MessageRowActions): MessageRowActions {
  const rowActionsRef = useRef(current);
  useLayoutEffect(() => {
    rowActionsRef.current = current;
  });
  return useMemo<MessageRowActions>(
    () => ({
      helperToggle: (measure, toggle, opening) =>
        rowActionsRef.current.helperToggle(measure, toggle, opening),
      reply: (message) => rowActionsRef.current.reply(message),
      quote: (message) => rowActionsRef.current.quote(message),
      select: (text) => rowActionsRef.current.select(text),
      speak: (message) => rowActionsRef.current.speak(message),
      react: (message, reaction) => rowActionsRef.current.react(message, reaction),
      markUnread: (message) => rowActionsRef.current.markUnread(message),
      answer: (message, answer, fields, dismiss, remember) =>
        rowActionsRef.current.answer(message, answer, fields, dismiss, remember),
      openComputer: () => rowActionsRef.current.openComputer(),
      previewFile: (artifactId) => rowActionsRef.current.previewFile(artifactId),
      previewImage: (target) => rowActionsRef.current.previewImage(target),
      jump: (id) => rowActionsRef.current.jump(id),
      dismissChoice: (id, question) => rowActionsRef.current.dismissChoice(id, question),
      layout: (id, y, index) => rowActionsRef.current.layout(id, y, index),
    }),
    [],
  );
}

/** Renders the chat's message rows for the live list and pinned pages. */
export function useThreadRows({
  snap,
  userId,
  transcript,
  rowActions,
  threadId,
  inGroup,
  readOnly,
  mentionTargets,
  doodleStatus,
  userBubble,
  columnWidth,
  readSeq,
  markedUnreadMessageId,
  highlightedMessageId,
}: {
  snap: MobileSnapshot | null;
  userId: string;
  transcript: ReturnType<typeof useThreadTranscript>;
  rowActions: MessageRowActions;
  threadId?: string;
  /** Other people are in the chat. */
  inGroup: boolean;
  readOnly: boolean;
  mentionTargets: readonly UserMentionTarget[];
  /** Doodle's activity in the chat, for its live progress row. */
  doodleStatus?: string;
  userBubble?: UserBubble;
  columnWidth: number;
  /** What the user had read up to when this visit began. */
  readSeq: number | null;
  markedUnreadMessageId?: string;
  highlightedMessageId: string | null;
}) {
  const { t, locale } = useI18n();
  const { showBotSenderName, reactionView, visibleMessages } = transcript;
  // Everyone sees an approval card; only the person whose request it is can answer it.
  const answerableAskIds = useMemo(() => {
    const runs = [...(snap?.activeRuns ?? []), ...(snap?.run ? [snap.run] : [])];
    const askers = new Map(runs.map((run) => [run.id, run.userId]));
    const ids = answerableAskMessageIds(snap);
    for (const message of snap?.messages ?? []) {
      const asker = message.runId ? askers.get(message.runId) : undefined;
      if (asker !== undefined && asker !== userId) ids.delete(message.id);
    }
    return ids;
  }, [snap, userId]);
  const dismissableAskIds = useMemo(() => dismissableAskMessageIds(snap, userId), [snap, userId]);
  const separatorIds = useMemo(() => timeSeparatorIds(visibleMessages), [visibleMessages]);
  const unreadDividerId = useMemo(
    () => unreadDividerMessageId(visibleMessages, readSeq, snap?.olderCursor ?? null),
    [visibleMessages, readSeq, snap?.olderCursor],
  );
  const liveItems = useMemo(() => [...visibleMessages].reverse(), [visibleMessages]);
  const messagesById = useMemo(
    () => new Map((snap?.messages ?? []).map((message) => [message.id, message])),
    [snap?.messages],
  );
  const people = snap?.chat.members;

  const renderMessageRow = useCallback(
    (message: MobileMessage, options?: { enableJump?: boolean; index?: number }) => {
      const parent = message.replyToMessageId
        ? messagesById.get(message.replyToMessageId)
        : undefined;
      const replyAuthor =
        (message.replyPreview?.role ?? parent?.role) === "user"
          ? (otherAuthor(message.replyPreview?.author ?? parent?.author, userId)?.name ?? t("You"))
          : DOODLE_NAME;
      const messageReactions = reactionView.reactions.get(message.id);
      const showActivity = message.role === "bot" && message.id.startsWith("progress:");
      const author = message.role === "user" ? otherAuthor(message.author, userId) : undefined;
      const authorImage = author
        ? (people?.find((person) => person.userId === author.id)?.image ?? null)
        : null;
      return (
        <MessageRow
          key={message.id}
          message={message}
          actions={rowActions}
          threadId={threadId}
          showBotSenderName={showBotSenderName}
          mentionTargets={mentionTargets}
          readOnly={readOnly}
          canAnswer={!readOnly && answerableAskIds.has(message.id)}
          canDismiss={dismissableAskIds.has(message.id)}
          highlighted={highlightedMessageId === message.id}
          separator={separatorIds.has(message.id)}
          headerAdjacent={threadHeaderFloats() && message.id === visibleMessages[0]?.id}
          unreadDivider={message.id === unreadDividerId}
          markedUnread={message.id === markedUnreadMessageId}
          author={author ? { name: author.name, image: authorImage } : undefined}
          replyAuthor={replyAuthor}
          replyFallbackText={parent ? previewMessageText(parent) : undefined}
          waitingForUser={[...(snap?.activeRuns ?? []), ...(snap?.run ? [snap.run] : [])].some(
            (run) =>
              run.id === message.runId &&
              (run.status === "waiting_input" || run.status === "waiting_takeover"),
          )}
          messageReactions={messageReactions}
          activity={
            showActivity
              ? {
                  identity: threadId ?? "",
                  status:
                    snap?.activeRuns?.find((run) => run.id === message.runId)?.status ??
                    doodleStatus,
                }
              : undefined
          }
          userBubble={userBubble}
          inGroup={inGroup}
          columnWidth={columnWidth}
          enableJump={options?.enableJump ?? false}
          index={options?.index ?? 0}
        />
      );
    },
    [
      messagesById,
      showBotSenderName,
      people,
      snap?.activeRuns,
      snap?.run,
      mentionTargets,
      reactionView,
      inGroup,
      threadId,
      doodleStatus,
      userBubble,
      rowActions,
      readOnly,
      answerableAskIds,
      dismissableAskIds,
      highlightedMessageId,
      separatorIds,
      visibleMessages[0]?.id,
      unreadDividerId,
      markedUnreadMessageId,
      columnWidth,
      userId,
      t,
      locale,
    ],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<MobileMessage>) => renderMessageRow(item),
    [renderMessageRow],
  );

  return { liveItems, renderMessageRow, renderItem };
}
