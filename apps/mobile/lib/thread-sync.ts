import { isRetryableError } from "@labradoodle/core";
import { useFocusEffect } from "expo-router";
import type { RefObject } from "react";
import { useCallback, useEffect } from "react";
import { mergeMobileSnapshot, mobileThreadRefreshResult, rpc, selectedSpaceId } from "./api";
import { onConversationCleared } from "./conversation-cleared";
import { useI18n } from "./i18n";
import { isIntegrationsScopeCurrent } from "./integrations-cache";
import { threadRefreshDelayMs } from "./refresh";
import {
  liveSavedChatsScope,
  readSavedThread,
  savedChatsScope,
  writeSavedThread,
} from "./saved-chats";
import { currentSessionGeneration } from "./session";
import type { ThreadHistory } from "./thread-history";
import type { ThreadListScroll } from "./thread-list-scroll";
import { useThreadLiveSubscription } from "./thread-live";
import type { ThreadJump } from "./thread-window";
import { applyThreadMessageJump, showLatestThread } from "./thread-window";
import { errorText } from "./user-error";

/**
 * Keeps the chat's snapshot current: the saved copy until live data arrives, refreshes, the live
 * stream, the safety refresh, saving the latest messages, and search jumps.
 *
 * Effect order matters and matches the screen before this hook was split out: the live
 * subscription bumps the history epoch before the search jump effect captures it, and the pending
 * save flush runs before a new save is scheduled.
 */
export function useThreadSync({
  history,
  scroll,
  threadId,
  messageId,
  readOnly,
  foreground,
  sessionEpoch,
  activeThreadId,
  readVisibleTarget,
  setError,
  onRefreshed,
  markReadIfVisible,
}: {
  history: ThreadHistory;
  scroll: ThreadListScroll;
  threadId?: string;
  /** A search hit to open the chat around. */
  messageId?: string;
  readOnly: boolean;
  foreground: boolean;
  sessionEpoch: number;
  activeThreadId: RefObject<string | undefined>;
  readVisibleTarget: RefObject<string | null>;
  setError: (error: string | null) => void;
  /** A refresh for the chat on screen finished, committed or not. */
  onRefreshed: (threadKey: string | undefined) => void;
  markReadIfVisible: () => void;
}) {
  const { t } = useI18n();
  const {
    snap,
    showingSaved,
    setShowingSaved,
    commitSnap,
    snapRef,
    snapshotOrigin,
    pendingSave,
    expandedHistoryThread,
    historyEpoch,
    refreshGeneration,
    pinnedAroundRef,
    jumpScrollTarget,
    jumpAnchor,
  } = history;

  function isCurrentTarget(targetThreadId: string | undefined) {
    return activeThreadId.current === targetThreadId;
  }

  /** Shows the chat's saved copy until live data for it arrives; never under a search jump. */
  function showSavedThread(signal: AbortSignal) {
    const target = threadId;
    if (!target) return;
    // Another chat's messages must never stay on screen under this chat's name.
    if (snapRef.current && snapRef.current.threadId !== target) {
      commitSnap(null);
      setShowingSaved(false);
    }
    void savedChatsScope().then((scope) => {
      if (signal.aborted || !scope) return;
      const onScreen = snapRef.current;
      if (messageId || (onScreen && onScreen.threadId === target)) return;
      const saved = readSavedThread(scope, target);
      if (!saved) return;
      snapshotOrigin.current = scope;
      commitSnap(saved);
      setShowingSaved(true);
    });
  }

  async function refresh() {
    if (!threadId) return;
    const targetThreadId = threadId;
    const epoch = historyEpoch.current;
    const origin = {
      sessionGeneration: currentSessionGeneration(),
      selectionId: selectedSpaceId(),
    };
    const generation = ++refreshGeneration.current;
    const next = await rpc("threads/get", { threadId: targetThreadId });
    if (
      origin.sessionGeneration !== currentSessionGeneration() ||
      origin.selectionId !== selectedSpaceId()
    )
      return;
    const scope = await liveSavedChatsScope();
    if (
      !scope ||
      scope.sessionGeneration !== origin.sessionGeneration ||
      scope.selectionId !== origin.selectionId ||
      !isIntegrationsScopeCurrent(scope)
    )
      return;
    // Only the newest started refresh may commit. Threads also receive live
    // events; an older snapshot must not overwrite those while a newer refresh
    // is already in flight. The subscription starts from the snapshot returned
    // here, so a discarded fetch must not supply its cursor.
    const result = mobileThreadRefreshResult({
      fetched: next,
      onScreen: snapRef.current,
      requestGeneration: generation,
      currentGeneration: refreshGeneration.current,
      requestEpoch: epoch,
      currentEpoch: historyEpoch.current,
      targetThreadId,
      activeThreadId: activeThreadId.current,
    });
    if (result.commit) {
      snapshotOrigin.current = scope;
      pendingSave.current = null;
      writeSavedThread(scope, next.threadId, next);
      commitSnap(
        mergeMobileSnapshot(snapRef.current, next, expandedHistoryThread.current === next.threadId),
      );
      setShowingSaved(false);
    }
    if (isCurrentTarget(targetThreadId)) onRefreshed(targetThreadId);
    return result.snapshot ?? undefined;
  }

  const threadJump: ThreadJump = {
    ...history,
    scrollBehavior: scroll.behavior,
    setThreadScrollState: scroll.setState,
    activeThreadId,
  };

  function applyMessageJump(target: { threadId: string; messageId: string }) {
    return applyThreadMessageJump(threadJump, target);
  }

  function showLatest() {
    showLatestThread(threadJump);
  }

  const onChatChanged = useCallback(() => void refresh().catch(() => undefined), [threadId]);

  const liveSubscribed = useThreadLiveSubscription({
    threadId,
    foreground,
    readOnly,
    sessionEpoch,
    messageId,
    historyEpoch,
    expandedHistoryThread,
    pinnedAroundRef,
    jumpScrollTarget,
    jumpAnchor,
    snapRef,
    readVisibleTarget,
    showSavedThread,
    refresh,
    commitSnap,
    setError,
    onChatChanged,
    markReadIfVisible,
  });

  useEffect(() => () => pendingSave.current?.(), [threadId]);

  // A save still waiting when the chat is cleared would write the old messages back.
  useEffect(() => {
    if (!threadId) return;
    return onConversationCleared((clearedThreadId) => {
      if (clearedThreadId === threadId) pendingSave.current = null;
    });
  }, [threadId]);

  // Save the latest messages of the live chat (not a jump or loaded history) once updates settle.
  useEffect(() => {
    if (
      !snap ||
      showingSaved ||
      jumpScrollTarget.current ||
      pinnedAroundRef.current ||
      expandedHistoryThread.current
    )
      return;
    const target = threadId;
    const latest = snapRef.current;
    if (!target || !latest || latest.threadId !== target) return;
    const origin = snapshotOrigin.current;
    if (!origin) return;
    const write = () => writeSavedThread(origin, target, latest);
    pendingSave.current = write;
    const timer = setTimeout(() => {
      pendingSave.current?.();
      pendingSave.current = null;
    }, 600);
    return () => clearTimeout(timer);
  }, [snap, showingSaved, threadId]);

  // The safety snapshot is a gap detector, not the live path: SSE already carries
  // deltas. Stop the timer while the app is backgrounded; the stream effect resumes
  // from its cursor when the app returns.
  useFocusEffect(
    useCallback(() => {
      if (!foreground || !threadId) return;
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let ticking = false;
      const refreshDelay = () =>
        threadRefreshDelayMs(snap?.run?.status, {
          liveSubscribed: liveSubscribed.current,
          readOnly,
        });
      function schedule() {
        if (!cancelled) timer = setTimeout(() => void tick(), refreshDelay());
      }
      async function tick() {
        if (cancelled || ticking) return;
        ticking = true;
        let failure: unknown;
        try {
          if (!jumpScrollTarget.current && !expandedHistoryThread.current) {
            await refresh().catch((error: unknown) => {
              failure = error;
            });
          }
        } finally {
          ticking = false;
          if (isRetryableError(failure)) schedule();
        }
      }
      schedule();
      return () => {
        cancelled = true;
        if (timer !== undefined) clearTimeout(timer);
      };
    }, [threadId, foreground, readOnly, snap?.run?.status]),
  );

  useEffect(() => {
    if (!threadId) return;
    // A conversation hit is the thread itself: stay on the live tail, not an older page.
    if (!messageId) {
      const pinned = pinnedAroundRef.current != null || jumpAnchor.current.holds();
      jumpAnchor.current.release();
      jumpScrollTarget.current = null;
      pinnedAroundRef.current = null;
      if (pinned) {
        expandedHistoryThread.current = null;
        commitSnap(snapRef.current);
      }
      return;
    }
    jumpAnchor.current.begin(messageId);
    void applyMessageJump({ threadId, messageId }).catch((err) => {
      setError(errorText(err, t("Could not open message")));
    });
  }, [threadId, messageId, sessionEpoch]);

  return { isCurrentTarget, refresh, applyMessageJump, showLatest };
}
