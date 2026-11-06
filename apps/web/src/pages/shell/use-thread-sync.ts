import type {
  AppBootstrap,
  Chat,
  ProductEvent,
  RoutineHistory,
  ThreadSnapshot,
} from "@labradoodle/contracts";
import {
  anySignal,
  createRefreshCoalescer,
  isRunTerminalEvent,
  isRunWorking,
  runThreadSubscription,
} from "@labradoodle/core";
import { fetchFresh } from "@labradoodle/core/query";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  newLogoAvatarActivitySource,
  openLogoAvatarActivityFeed,
  webLogoAvatarActivity,
} from "../../lib/logo-avatar-activity.js";
import { relistPagesForBlocks } from "../../lib/page-actions";
import { markOnce } from "../../lib/performance";
import type { SpaceQueries } from "../../lib/query";
import { queryClient } from "../../lib/query";
import type { createSpaceRpc } from "../../lib/rpc";
import {
  activeThreadRuns,
  isComputerStatusEvent,
  isThreadSnapshotEvent,
  prependThreadMessagePage,
  reconcileRefreshedThread,
  reduceComputerStatus,
  reduceThreadSnapshot,
} from "../../lib/thread-events";
import {
  firstVisibleTranscriptRow,
  transcriptCanSnapAfterFrame,
  transcriptIsNearEnd,
} from "../../lib/transcript-scroll";
import type { ComputerState } from "./use-computer";
import type { ThreadState } from "./use-thread-state";

const THREAD_SNAPSHOT_TIMEOUT_MS = 2_000;

function threadSnapshotSignal(parent: AbortSignal): AbortSignal {
  return anySignal([parent, AbortSignal.timeout(THREAD_SNAPSHOT_TIMEOUT_MS)]);
}

/** A computer event in a chat is about the person whose run it is; only theirs changes this view. */
function isOwnComputerEvent(
  event: ProductEvent,
  snapshot: ThreadSnapshot | null,
  userId: string | undefined,
) {
  if (!event.runId || !userId) return false;
  const run = activeThreadRuns(snapshot).find((candidate) => candidate.id === event.runId);
  return run?.userId === userId;
}

/** Loads the open chat, keeps it live, and pages in its older history. */
export function useThreadSync({
  rpc,
  queries,
  thread,
  computerState,
  seed,
  active,
  userId,
  activeThreadId,
  searchParamsRef,
  refreshChats,
  markReadIfVisible,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  queries: SpaceQueries;
  thread: ThreadState;
  computerState: ComputerState;
  seed: AppBootstrap | undefined;
  active: Chat | undefined;
  userId: string | undefined;
  activeThreadId: RefObject<string | undefined>;
  searchParamsRef: RefObject<URLSearchParams>;
  refreshChats: () => Promise<void>;
  markReadIfVisible: (threadId: string) => void;
}) {
  const {
    snapshot,
    snapshotRef,
    commitSnapshot,
    updateSnapshot,
    setRoutines,
    setRoutinesThreadId,
    bootstrappedThread,
    expandedHistoryThread,
    historyEpoch,
    messageScroll,
    pinnedAroundRef,
    resetHistory,
  } = thread;
  const { computerRef, commitComputer, refreshComputerScreen } = computerState;
  const threadRefreshEpoch = useRef(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // A very fast run can finish over SSE while its threads.send response is still
  // returning. Do not let that late receipt resurrect terminal work as queued.
  const terminalRunReceipts = useRef(new Set<string>());

  /**
   * Each chat's last snapshot, so reopening it paints at once. The live load and
   * subscription still run and replace it, so it is only ever a first frame.
   */
  function cachedThreadKey(threadId: string) {
    return queries.threads.get.queryKey({ input: { threadId } });
  }

  function snapTranscriptToEndAfterFrame() {
    const queuedElement = messageScroll.current;
    if (!queuedElement) return;
    const queuedScrollTop = queuedElement.scrollTop;
    window.requestAnimationFrame(() => {
      const element = messageScroll.current;
      if (transcriptCanSnapAfterFrame(element, queuedElement, queuedScrollTop)) {
        queuedElement.scrollTop = queuedElement.scrollHeight;
      }
    });
  }

  async function refreshThread(id: string, signal?: AbortSignal) {
    const scrollElement = messageScroll.current;
    const stickToEnd = !scrollElement || transcriptIsNearEnd(scrollElement);
    markOnce("rk:renderer:thread-request-start");
    const epoch = historyEpoch.current;
    const request = ++threadRefreshEpoch.current;
    // Apply threads.get as soon as it returns so stop/takeover status is not held behind
    // the routines and screen fetches (progress can advance the cursor meanwhile).
    const snap = await rpc.threads.get({ threadId: id }, signal ? { signal } : undefined);
    markOnce("rk:renderer:thread-response");
    if (
      activeThreadId.current !== id ||
      epoch !== historyEpoch.current ||
      request !== threadRefreshEpoch.current
    ) {
      return snap;
    }
    const reconciled = reconcileRefreshedThread(
      snapshotRef.current,
      snap,
      computerRef.current,
      expandedHistoryThread.current === snap.threadId,
    );
    webLogoAvatarActivity.reconcile(snap);
    commitSnapshot(reconciled.snapshot);
    commitComputer(reconciled.computer);
    if (
      stickToEnd &&
      (!scrollElement || transcriptIsNearEnd(scrollElement)) &&
      expandedHistoryThread.current !== snap.threadId
    ) {
      snapTranscriptToEndAfterFrame();
    }
    void Promise.all([
      // Runs after routine changes too, so an older read in flight is not reused.
      fetchFresh(
        queryClient,
        queries.routines.list.queryOptions({ input: { threadId: id } }),
      ).catch(() => null),
      refreshComputerScreen().catch(() => null),
    ]).then(([routines]) => {
      if (
        activeThreadId.current !== id ||
        epoch !== historyEpoch.current ||
        request !== threadRefreshEpoch.current
      ) {
        return;
      }
      if (routines) {
        setRoutines(routines);
        setRoutinesThreadId(id);
      }
    });
    return snap;
  }

  /** An open run history that already lists the finished run shows its outcome without its poll. */
  function refreshRoutineHistory(runId: string | null | undefined) {
    if (!runId) return;
    void queryClient.invalidateQueries({
      queryKey: queries.routines.history.key(),
      predicate: (query) =>
        (query.state.data as { pages?: RoutineHistory[] } | undefined)?.pages?.some((page) =>
          page.runs.some((run) => run.id === runId),
        ) ?? false,
    });
  }

  async function loadOlderMessages() {
    const threadId = active?.id;
    if (
      !threadId ||
      snapshot?.threadId !== threadId ||
      snapshot.olderCursor == null ||
      loadingOlder
    )
      return;
    pinnedAroundRef.current = null;
    const scrollElement = messageScroll.current;
    // Hold the first visible row steady: a plain height delta would also count
    // content appended at the bottom while the older page was loading.
    const anchorRow = firstVisibleTranscriptRow(scrollElement);
    const anchorTop = anchorRow?.offsetTop ?? null;
    const previousHeight = scrollElement?.scrollHeight ?? 0;
    const epoch = historyEpoch.current;
    const before = snapshot.olderCursor;
    setLoadingOlder(true);
    try {
      const page = await rpc.threads.messages({ threadId, before });
      if (epoch !== historyEpoch.current || activeThreadId.current !== threadId) return;
      expandedHistoryThread.current = page.threadId;
      updateSnapshot((prev) => prependThreadMessagePage(prev, page));
      window.requestAnimationFrame(() => {
        const element = messageScroll.current;
        if (!element) return;
        element.scrollTop +=
          anchorRow?.isConnected && anchorTop !== null
            ? anchorRow.offsetTop - anchorTop
            : element.scrollHeight - previousHeight;
      });
    } finally {
      setLoadingOlder(false);
    }
  }

  useEffect(() => {
    if (!active) return;
    const threadId = active.id;
    const pendingJump = searchParamsRef.current.get("m");
    if (!pendingJump) pinnedAroundRef.current = null;
    expandedHistoryThread.current = null;
    historyEpoch.current += 1;
    const threadKey = cachedThreadKey(threadId);
    const cachedThread = pendingJump
      ? undefined
      : (queryClient.getQueryData(threadKey) ??
        (seed?.thread?.threadId === threadId ? seed.thread : undefined));
    if (
      cachedThread &&
      snapshotRef.current?.threadId !== threadId &&
      activeThreadRuns(cachedThread).some((run) => isRunWorking(run.status)) ===
        isRunWorking(active.status)
    )
      commitSnapshot(cachedThread);
    const listRefresh = createRefreshCoalescer(() => refreshChats());
    const snapshotRefresh = createRefreshCoalescer(() => refreshThread(threadId));
    const abort = new AbortController();
    const avatarSource = newLogoAvatarActivitySource();
    void runThreadSubscription({
      signal: abort.signal,
      loadInitial: async () => {
        const primed = bootstrappedThread.current;
        bootstrappedThread.current = null;
        // Pending search jumps load the around-page separately; avoid replacing it with latest.
        return primed?.threadId === threadId
          ? primed
          : pendingJump
            ? rpc.threads.get({ threadId }, { signal: threadSnapshotSignal(abort.signal) })
            : refreshThread(threadId, threadSnapshotSignal(abort.signal));
      },
      loadHead: () =>
        rpc.threads.head({ threadId }, { signal: threadSnapshotSignal(abort.signal) }),
      refresh: () => refreshThread(threadId, threadSnapshotSignal(abort.signal)),
      currentSnapshot: () => snapshotRef.current,
      subscribe: (cursor, signal) =>
        openLogoAvatarActivityFeed(avatarSource, snapshotRef.current, cursor, signal, () =>
          rpc.threads.subscribe({ threadId, cursor }, { signal }),
        ),
      beforeEvent: (event) => {
        webLogoAvatarActivity.apply(avatarSource, event);
        if (isRunTerminalEvent(event) && event.runId) {
          terminalRunReceipts.current.add(event.runId);
          if (terminalRunReceipts.current.size > 100) {
            const oldest = terminalRunReceipts.current.values().next().value;
            if (oldest !== undefined) terminalRunReceipts.current.delete(oldest);
          }
        }
      },
      applyEvent: (event) => {
        const ownComputer =
          isComputerStatusEvent(event) && isOwnComputerEvent(event, snapshotRef.current, userId);
        if (isThreadSnapshotEvent(event)) {
          commitSnapshot(reduceThreadSnapshot(snapshotRef.current, event));
        }
        if (ownComputer) commitComputer(reduceComputerStatus(computerRef.current, event));
      },
      onEvent: (event) => {
        if (event.type === "thread.cleared") resetHistory();
        if (
          event.type === "thread.message.created" ||
          event.type === "run.started" ||
          isRunTerminalEvent(event) ||
          event.type === "thread.cleared"
        ) {
          void listRefresh.invalidate().catch(() => undefined);
        }
        if (event.type === "thread.message.created") {
          const blocks = (event.payload.blocks as Array<{ kind?: string }>) ?? [];
          relistPagesForBlocks(queries, queryClient, blocks);
          markReadIfVisible(threadId);
        }
        if (
          isRunTerminalEvent(event) ||
          event.type === "run.waiting_input" ||
          event.type === "skill.teaching.stopped"
        ) {
          // waiting_input: reconcile ask cards if a stale post-send refresh raced SSE.
          void snapshotRefresh.invalidate().catch(() => undefined);
        } else if (isComputerStatusEvent(event)) {
          void refreshComputerScreen().catch(() => undefined);
        }
        if (isRunTerminalEvent(event)) refreshRoutineHistory(event.runId);
      },
    });
    return () => {
      listRefresh.dispose();
      snapshotRefresh.dispose();
      abort.abort();
      webLogoAvatarActivity.resetSource(avatarSource);
      const left = snapshotRef.current;
      if (left?.threadId === threadId) queryClient.setQueryData(threadKey, left);
    };
  }, [active?.id, markReadIfVisible]);

  // Memoized children take these, so they stay referentially stable across renders.
  const refreshThreadRef = useRef(refreshThread);
  refreshThreadRef.current = refreshThread;
  const loadOlderMessagesRef = useRef(loadOlderMessages);
  loadOlderMessagesRef.current = loadOlderMessages;
  const loadOlder = useCallback(() => loadOlderMessagesRef.current(), []);
  const refreshActiveThread = useCallback(async () => {
    const id = activeThreadId.current;
    if (!id) return;
    await refreshThreadRef.current(id);
  }, []);

  return {
    refreshThread,
    refreshThreadRef,
    refreshActiveThread,
    loadOlder,
    loadingOlder,
    terminalRunReceipts,
  };
}
