import type { AgentSkillCatalogEntry } from "@labradoodle/contracts";
import {
  buildComposerMentionOptions,
  DOODLE_NAME,
  isRunWaitingOnUser,
  isRunWorking,
  liveActivityLine,
  liveMessageComposing,
  newClientId,
  newestPageCards,
  otherAuthor,
} from "@labradoodle/core";
import { useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { I18nManager, Platform, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { readableGutters } from "../../lib/adaptive-layout";
import { rpc } from "../../lib/api";
import { useAppForeground } from "../../lib/app-foreground";
import { mobileTokens } from "../../lib/appearance";
import type { MobileArtifactTarget } from "../../lib/artifact-open";
import { composerDraftScope } from "../../lib/composer-draft";
import { cronLabels } from "../../lib/cron";
import { useDoodle } from "../../lib/doodle";
import { useI18n } from "../../lib/i18n";
import { userMentionTargets } from "../../lib/message-mentions";
import { useThemedStyles } from "../../lib/native";
import { useChatOnScreen } from "../../lib/page-card-detail";
import { useInboxChat } from "../../lib/search-inbox";
import { useSplitView } from "../../lib/split-view";
import { useIncomingShareImport, useThreadAttachments } from "../../lib/thread-attachments";
import {
  threadColumnPadding,
  threadHeaderClearance,
  threadHeaderFloats,
} from "../../lib/thread-edges";
import { useThreadFeedback } from "../../lib/thread-feedback";
import { useThreadFocus } from "../../lib/thread-focus";
import { useThreadSnapshot } from "../../lib/thread-history";
import { threadKeyboardAvoidance } from "../../lib/thread-keyboard-offset";
import { useThreadListScroll } from "../../lib/thread-list-scroll";
import { useThreadMentionCatalog } from "../../lib/thread-mention-catalog";
import { useThreadPaging } from "../../lib/thread-paging";
import { useThreadRead } from "../../lib/thread-read";
import { isOwnThreadMessage, latestThreadRowKey } from "../../lib/thread-scroll";
import { useThreadSend } from "../../lib/thread-send";
import { useThreadSync } from "../../lib/thread-sync";
import { useThreadTranscript } from "../../lib/thread-transcript";
import { useAutoSpeakReply, useSpeakMessages } from "../../lib/thread-voice";
import { liveEndRunError } from "../../lib/thread-window";
import { FailedSendBubble } from "../failed-send-bubble";
import { NewestPageCards } from "../pages/page-card";
import { RunErrorSheet } from "../run-error-sheet";
import { SelectTextSheet } from "../select-text-sheet";
import { ThreadComposer } from "../thread-composer";
import { ThreadErrorNotice, ThreadFetchErrorNotice } from "../thread-error-notice";
import { createThreadHeaderStyles } from "../thread-header-styles";
import { QuoteSheet } from "./quote-sheet";
import { ThreadComposerDock } from "./thread-composer-dock";
import { useThreadHeader } from "./thread-header";
import { LoadEarlierButton, ThreadWorkingFooter } from "./thread-list-controls";
import { ThreadMessageList } from "./thread-message-list";
import { useLatestRowActions, useThreadRows } from "./thread-rows";
import { useThreadRunError } from "./thread-run-error";

function isActiveStatus(status: string | undefined): boolean {
  return isRunWorking(status) || isRunWaitingOnUser(status);
}

/**
 * The chat screen. Hook order is effect order: the snapshot, scroll, sync and send hooks run their
 * effects at the positions the screen ran them before they were split out.
 */
export function Thread({ sessionEpoch, userId }: { sessionEpoch: number; userId: string }) {
  useChatOnScreen();
  const tokens = mobileTokens();
  const styles = useThemedStyles(createThreadHeaderStyles);
  const { t, locale } = useI18n();
  const focused = useIsFocused();
  const foreground = useAppForeground();
  const router = useRouter();
  // Beside the chat list on a wide window, the chat has only the width the list leaves.
  const { inboxShown, contentWidth: windowWidth } = useSplitView();
  const nativeHeaderHeight = useHeaderHeight();
  const headerHeight = threadHeaderFloats() ? nativeHeaderHeight : 0;
  const headerClearance = threadHeaderClearance(headerHeight);
  const insets = useSafeAreaInsets();
  // An unfolded or tablet window keeps messages and the composer in a centred reading column.
  const columnInsets = readableGutters(windowWidth, {
    left: inboxShown ? 0 : insets.left,
    right: insets.right,
  });
  const columnWidth = windowWidth - columnInsets.left - columnInsets.right;
  const columnPadding = useMemo(
    () => threadColumnPadding(columnInsets, I18nManager.isRTL),
    [columnInsets.left, columnInsets.right],
  );
  const { threadId: threadParam, messageId } = useLocalSearchParams<{
    threadId?: string;
    messageId?: string;
  }>();
  const threadId = typeof threadParam === "string" && threadParam ? threadParam : undefined;
  // The composer floats over the list, which scrolls underneath; this keeps the newest message
  // clear of it.
  const [dockHeight, setDockHeight] = useState(0);
  const activeThreadId = useRef(threadId);
  activeThreadId.current = threadId;
  const {
    threadKey,
    readVisit,
    readVisibleTarget,
    readBoundary,
    setReadBoundary,
    markedUnreadMessageId,
    markUnreadFrom,
    markReadIfVisible,
  } = useThreadRead({ threadId, focused });
  const markCaughtUp = () => setReadBoundary({ visit: readVisit.current.visit, seq: null });
  const artifactTarget: MobileArtifactTarget | undefined = threadId ? { threadId } : undefined;
  const history = useThreadSnapshot();
  const { snap, composing, showingSaved } = history;
  const { doodle: workspaceDoodle } = useDoodle();
  const [agentSkills, setAgentSkills] = useState<AgentSkillCatalogEntry[]>([]);
  const [me, setMe] = useState<{
    maxUploadSizeBytes?: number;
    maxAttachmentsPerMessage?: number;
    needsModel: boolean;
    readAloud: boolean;
  }>();
  // Re-read on focus so returning from Models settings updates unsent missing-model messages.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void rpc("me")
        .then((next) => {
          if (!cancelled) setMe(next);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // Until the chat's own snapshot arrives, the chat as the inbox last loaded it.
  const inboxChat = useInboxChat(threadId);
  const chat = snap?.threadId === threadId ? snap?.chat : inboxChat;
  const others = useMemo(
    () => (chat?.members ?? []).filter((member) => member.userId !== userId),
    [chat?.members, userId],
  );
  const inGroup = others.length > 0;
  const doodleOn = chat?.doodle ?? false;
  const mentionTargets = useMemo(
    () => (chat ? userMentionTargets(chat) : []),
    [chat?.doodle, chat?.members],
  );
  const {
    routines: mentionRoutines,
    connectors: mentionConnectors,
    onMentionRequested,
  } = useThreadMentionCatalog(JSON.stringify([userId, sessionEpoch, threadId]), threadId, doodleOn);
  const draftScope = useMemo(() => composerDraftScope(userId, threadId), [userId, threadId]);
  const attachments = useThreadAttachments({
    threadId,
    uploadConfig: me,
    draftScope,
  });
  const echoed = useMemo(
    () =>
      snap && snap.threadId === threadKey
        ? new Set(
            snap.messages.flatMap((message) =>
              message.role === "user" && message.seq !== undefined ? [message.seq] : [],
            ),
          )
        : undefined,
    [snap, threadKey],
  );
  const feedback = useThreadFeedback(threadKey, newClientId, echoed);
  const { error, setError } = feedback;
  const [selectableText, setSelectableText] = useState<string | null>(null);
  const transcript = useThreadTranscript(snap?.messages, inGroup);
  const { reactionView } = transcript;
  const visibleMessages = transcript.visibleMessages;
  const newestPages = useMemo(() => newestPageCards(visibleMessages), [visibleMessages]);
  const latestMessage = reactionView.visibleMessages.at(-1);
  const composerMentionTargets = useMemo(
    () =>
      buildComposerMentionOptions({
        query: "",
        doodle: doodleOn,
        people: others.map((person) => ({ id: person.userId, name: person.name })),
        routines: doodleOn
          ? mentionRoutines.map((routine) => ({
              id: routine.id,
              name: routine.name,
              crons: routine.crons,
            }))
          : [],
        connectors: mentionConnectors,
        cronLabels: cronLabels(locale),
      }),
    [doodleOn, locale, others, mentionConnectors, mentionRoutines],
  );
  const title = chat ? chat.title || t("New chat") : "";
  // Only a chat where Doodle answers everything is addressed to Doodle.
  const composerPrompt =
    doodleOn && !inGroup
      ? t("Message {name}", { name: DOODLE_NAME })
      : chat?.title
        ? t("Message {name}", { name: chat.title })
        : t("Message…");
  const doodleStatus =
    snap && (!showingSaved || error) ? snap.run?.status : (inboxChat?.status ?? snap?.run?.status);
  // Only reply text being written replaces the footer; earlier sentences above a tool call don't.
  const hasLiveProgress = visibleMessages.some(
    (message) => message.id.startsWith("progress:") && liveMessageComposing(message.blocks),
  );
  const activityLine = liveActivityLine(snap?.messages ?? []);
  const activeRuns = snap?.activeRuns ?? (snap?.run ? [snap.run] : []);
  const working =
    doodleOn &&
    (activeRuns.some((run) => isActiveStatus(run.status)) || isActiveStatus(doodleStatus));
  // Doodle waiting on someone (an ask card, a computer takeover) can still be stopped, but its
  // card is the state: no typing dots under it.
  const doodleWorking = doodleOn && isRunWorking(doodleStatus);

  const speakFinishedReplyRef = useAutoSpeakReply({
    threadId,
    readAloud: me?.readAloud ?? false,
    snap,
    showingSaved,
  });

  useEffect(() => {
    void rpc("agentSkills/list")
      .then(setAgentSkills)
      .catch(() => setAgentSkills([]));
  }, []);

  const scroll = useThreadListScroll({
    history,
    threadKey,
    anchor: headerClearance.anchor,
    visibleBottomInset: dockHeight,
    latestRowKey: latestThreadRowKey(
      latestMessage?.id ?? null,
      feedback.unsentSends.map((attempt) => attempt.clientNonce),
      isOwnThreadMessage(latestMessage, userId),
    ),
  });

  useThreadHeader({
    threadId,
    chat,
    viewerUserId: userId,
    title,
    status: doodleStatus,
    composing,
    onCleared: history.clear,
  });

  useThreadFocus({ threadId, markReadIfVisible, speakFinishedReplyRef });

  const { isCurrentTarget, refresh, applyMessageJump, showLatest } = useThreadSync({
    history,
    scroll,
    threadId,
    messageId,
    foreground,
    sessionEpoch,
    activeThreadId,
    readVisibleTarget,
    setError,
    onRefreshed: feedback.refreshed,
    markReadIfVisible,
  });

  const paging = useThreadPaging({
    history,
    scroll,
    threadId,
    visibleMessages,
    anchor: headerClearance.anchor,
    setError,
    showLatest,
  });

  const composer = useThreadSend({
    threadId,
    history,
    scroll,
    feedback,
    attachments,
    activeThreadId,
    isCurrentTarget,
    refresh,
    showLatest,
    markCaughtUp,
  });
  const { replyTarget, setReplyTarget, replyQuote, setReplyQuote, quoteTarget, setQuoteTarget } =
    composer;
  // A reply tapped on one of this chat's pages, full screen, lands in the composer unsent.
  useFocusEffect(composer.receivePageReply);
  useIncomingShareImport({
    attachments,
    composerRef: composer.composerRef,
    threadKey,
    uploadConfig: me,
  });

  const openComputer = useCallback(() => router.push("/computer"), [router]);

  const speak = useSpeakMessages({ visibleMessages });

  const { runError, normalizedRunError, runErrorAction, detailsOpen, setDetailsOpen } =
    useThreadRunError(snap?.run, workspaceDoodle?.canCustomize ?? false);

  // Event actions read the latest committed screen state without invalidating settled rows.
  const rowActions = useLatestRowActions({
    helperToggle: scroll.helperToggle,
    reply: (message) => {
      setReplyTarget(message);
      setReplyQuote(null);
    },
    quote: setQuoteTarget,
    select: setSelectableText,
    speak,
    react: composer.react,
    markUnread: markUnreadFrom,
    answer: composer.answer,
    openComputer,
    // A chat attachment opens the version it was sent with, not the newest.
    previewFile: (artifactId) =>
      router.push({ pathname: "/artifact", params: { artifactId, exact: "1" } }),
    previewImage: (target) =>
      router.push({ pathname: "/image", params: { ...target, threadId: threadId ?? "" } }),
    jump: (messageId) => {
      if (threadId) void applyMessageJump({ threadId, messageId }).catch(() => undefined);
    },
    layout: scroll.layoutJumpRow,
  });

  const { liveItems, renderMessageRow, renderItem } = useThreadRows({
    snap,
    userId,
    transcript,
    rowActions,
    threadId,
    inGroup,
    mentionTargets,
    doodleStatus,
    columnWidth,
    readSeq: readBoundary?.visit === readVisit.current.visit ? readBoundary.seq : null,
    markedUnreadMessageId,
    highlightedMessageId: scroll.highlightedMessageId,
  });

  const workingFooter = (
    <ThreadWorkingFooter
      working={doodleWorking && !hasLiveProgress && Boolean(threadId)}
      identity={threadId ?? ""}
      status={doodleStatus}
      composing={composing}
      atBottom={!scroll.state.detached}
      label={activityLine ?? t("Working…")}
    />
  );

  const loadEarlierControl =
    snap?.olderCursor != null ? (
      <LoadEarlierButton
        loading={paging.loadingOlder}
        onPress={() => void paging.loadOlderMessages()}
      />
    ) : null;

  const failedSendBubbles = feedback.unsentSends.map((attempt) => (
    <FailedSendBubble
      key={attempt.clientNonce}
      attempt={attempt}
      needsModel={doodleOn ? me?.needsModel : false}
      onRetry={() => composer.retry(attempt)}
      onDelete={() => feedback.discard(attempt)}
    />
  ));

  // Fetch failures stay visible at either paging edge; provider recovery belongs to the live end.
  const visibleRunError = liveEndRunError(normalizedRunError, scroll.pinnedNewerCursor);
  const errorNotice = (
    <ThreadErrorNotice
      error={null}
      summary={visibleRunError?.summary ?? null}
      resetAt={visibleRunError?.resetAt}
      onDetails={() => setDetailsOpen(true)}
      action={visibleRunError ? runErrorAction : null}
    />
  );

  return (
    <View style={{ flex: 1 }}>
      <KeyboardAvoidingView
        // Padding always settles to zero. "height" stays shrunk when the keyboard hides without
        // move frames, such as when a pushed screen closes with its own keyboard up.
        behavior="padding"
        {...threadKeyboardAvoidance({
          os: Platform.OS,
          floatingHeader: threadHeaderFloats(),
          nativeHeaderHeight,
        })}
        style={{
          flex: 1,
          backgroundColor: tokens.background,
        }}
      >
        {/* The keyboard's padding shrinks this, so the floating composer rides above it. */}
        <View style={{ flex: 1 }}>
          <NewestPageCards.Provider value={newestPages}>
            <ThreadMessageList
              scroll={scroll}
              pinnedListHandlers={paging.pinnedListHandlers}
              threadKey={threadKey}
              headerClearance={headerClearance}
              bottomInset={dockHeight}
              columnPadding={columnPadding}
              visibleMessages={visibleMessages}
              liveItems={liveItems}
              renderItem={renderItem}
              renderMessageRow={renderMessageRow}
              loadEarlierControl={loadEarlierControl}
              failedSendBubbles={failedSendBubbles}
              errorNotice={errorNotice}
              workingFooter={workingFooter}
              loadingNewer={paging.loadingNewer}
              showLatest={showLatest}
            />
          </NewestPageCards.Provider>
          {/* Shrinks (the suggestion lists scroll) so the input and Send stay above the keyboard. */}
          <ThreadComposerDock
            columnPadding={columnPadding}
            notice={<ThreadFetchErrorNotice error={error} showingSaved={showingSaved} />}
            onHeight={setDockHeight}
            replyTarget={replyTarget}
            replyAuthor={
              replyTarget?.role === "user"
                ? (otherAuthor(replyTarget.author, userId)?.name ?? t("You"))
                : DOODLE_NAME
            }
            replyQuote={replyQuote}
            threadTarget={artifactTarget}
            onDismissReply={() => {
              setReplyTarget(null);
              setReplyQuote(null);
            }}
            attachmentNotice={attachments.attachmentNotice}
            attachments={attachments.activePendingAttachments}
            onRemoveAttachment={(id) =>
              attachments.setPendingAttachments((current) =>
                current.filter((item) => item.id !== id),
              )
            }
          >
            <ThreadComposer
              key={threadKey}
              ref={composer.composerRef}
              draftScope={draftScope}
              agentSkills={agentSkills}
              composerMentionTargets={composerMentionTargets}
              onMentionRequested={onMentionRequested}
              composerPrompt={composerPrompt}
              replyTargetId={replyTarget?.id}
              replyQuote={replyQuote}
              attachmentIds={attachments.activePendingAttachments.map(
                (attachment) => attachment.id,
              )}
              working={working}
              sending={composer.sending || attachments.shareImporting}
              styles={styles}
              attachActions={attachments.attachActions}
              attachFrom={attachments.attachFrom}
              send={composer.send}
              stop={composer.stop}
              onSlashAction={composer.runSlashAction}
              onEmptied={composer.composerEmptied}
            />
          </ThreadComposerDock>
        </View>
        {selectableText !== null ? (
          <SelectTextSheet text={selectableText} onClose={() => setSelectableText(null)} />
        ) : null}
        <RunErrorSheet
          details={detailsOpen ? runError : null}
          onClose={() => setDetailsOpen(false)}
          action={runErrorAction}
        />
        {quoteTarget ? (
          <QuoteSheet
            message={quoteTarget}
            onCancel={() => setQuoteTarget(null)}
            onQuote={(excerpt) => {
              setReplyTarget(quoteTarget);
              setReplyQuote(excerpt);
              setQuoteTarget(null);
            }}
          />
        ) : null}
        {/* The header buttons float over the chat; only the clock gets a soft backdrop. */}
        {headerHeight > 0 ? (
          <View pointerEvents="none" style={[styles.statusBarFade, { height: insets.top }]} />
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}
