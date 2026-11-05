import {
  answerableAskMessageIds,
  dismissableAskMessageIds,
  memberName,
  otherAuthor,
  timeSeparatorIds,
  unreadDividerMessageId,
} from "@labradoodle/core";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { ListRenderItemInfo } from "react-native";
import type { MobileBot, MobileMessage, MobileSnapshot } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
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
      openBot: (id, name) => rowActionsRef.current.openBot(id, name),
      openComputer: (id, name) => rowActionsRef.current.openComputer(id, name),
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
  botId,
  groupId,
  inGroup,
  readOnly,
  displayName,
  mentionBots,
  currentBot,
  currentBotStatus,
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
  botId?: string;
  groupId?: string;
  inGroup: boolean;
  readOnly: boolean;
  displayName?: string;
  mentionBots: MobileBot[];
  currentBot?: MobileBot;
  currentBotStatus?: string;
  userBubble?: UserBubble;
  columnWidth: number;
  /** What the user had read up to when this visit began. */
  readSeq: number | null;
  markedUnreadMessageId?: string;
  highlightedMessageId: string | null;
}) {
  const { t, locale } = useI18n();
  const { showBotSenderName, reactionView, visibleMessages } = transcript;
  const answerableAskIds = useMemo(() => answerableAskMessageIds(snap), [snap]);
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

  const renderMessageRow = useCallback(
    (message: MobileMessage, options?: { enableJump?: boolean; index?: number }) => {
      const parent = message.replyToMessageId
        ? messagesById.get(message.replyToMessageId)
        : undefined;
      const replyBotId = message.replyPreview?.botId ?? parent?.botId;
      const replyAuthor =
        (message.replyPreview?.role ?? parent?.role) === "user"
          ? (otherAuthor(message.replyPreview?.author ?? parent?.author, userId)?.name ?? t("You"))
          : (memberName(snap?.members, replyBotId) ??
            mentionBots.find((bot) => bot.id === replyBotId)?.name ??
            displayName ??
            t("Bot"));
      const messageReactions = reactionView.reactions.get(message.id);
      const activityBotId =
        !inGroup && message.role === "bot" && message.id.startsWith("progress:")
          ? (message.botId ?? botId)
          : undefined;
      const activityBot = activityBotId
        ? (snap?.members?.find((member) => member.botId === activityBotId) ??
          (currentBot?.id === activityBotId ? currentBot : undefined))
        : undefined;
      const activityStatus = activityBotId
        ? (snap?.activeRuns?.find((run) => run.botId === activityBotId)?.status ??
          (snap?.run?.botId === activityBotId ? snap.run.status : currentBotStatus))
        : undefined;
      return (
        <MessageRow
          key={message.id}
          message={message}
          actions={rowActions}
          botId={botId}
          bubbleBotId={botId ?? snap?.members?.[0]?.botId ?? ""}
          groupId={groupId}
          botName={displayName}
          showBotSenderName={showBotSenderName}
          bots={mentionBots}
          members={snap?.members}
          readOnly={readOnly}
          canAnswer={!readOnly && answerableAskIds.has(message.id)}
          canDismiss={dismissableAskIds.has(message.id)}
          highlighted={highlightedMessageId === message.id}
          separator={separatorIds.has(message.id)}
          headerAdjacent={threadHeaderFloats() && message.id === visibleMessages[0]?.id}
          unreadDivider={message.id === unreadDividerId}
          markedUnread={message.id === markedUnreadMessageId}
          authorName={
            message.role === "user" ? otherAuthor(message.author, userId)?.name : undefined
          }
          replyAuthor={replyAuthor}
          replyFallbackText={parent ? previewMessageText(parent) : undefined}
          waitingForUser={[...(snap?.activeRuns ?? []), ...(snap?.run ? [snap.run] : [])].some(
            (run) =>
              run.id === message.runId &&
              (run.status === "waiting_input" || run.status === "waiting_takeover"),
          )}
          messageReactions={messageReactions}
          activityBotId={activityBotId}
          activityColor={activityBot?.color}
          activityStatus={activityStatus}
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
      snap?.members,
      snap?.activeRuns,
      snap?.run,
      mentionBots,
      displayName,
      reactionView,
      inGroup,
      botId,
      groupId,
      currentBot,
      currentBotStatus,
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
