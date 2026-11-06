import type { ComputerStatus, Routine } from "@labradoodle/contracts";
import { fetchFresh } from "@labradoodle/core/query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import type { SpaceQueries } from "../../lib/query";
import { queryClient } from "../../lib/query";
import type { Panel } from "../../lib/right-panel-state";
import type { createSpaceRpc } from "../../lib/rpc";
import type { ThreadState } from "./use-thread-state";

type JumpTarget = { threadId: string; messageId: string };

/**
 * Opening a chat at a message: search hits and deep links (`?m=`, `?routine=`), reply quotes,
 * and the first scroll to the end of a newly opened chat.
 */
export function useMessageJump({
  rpc,
  queries,
  thread,
  commitComputer,
  threadId,
  activeThreadId,
  searchParams,
  setSearchParams,
  setPanel,
  setPanelState,
  editRoutine,
  resetRoutineTarget,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  queries: SpaceQueries;
  thread: ThreadState;
  commitComputer: (next: ComputerStatus | null) => void;
  threadId: string | undefined;
  activeThreadId: RefObject<string | undefined>;
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
  setPanel: (panel: Panel) => void;
  setPanelState: Dispatch<SetStateAction<Panel>>;
  editRoutine: (routine: Routine) => void;
  resetRoutineTarget: () => void;
}) {
  const {
    snapshot,
    commitSnapshot,
    routines,
    setRoutines,
    routinesThreadId,
    setRoutinesThreadId,
    expandedHistoryThread,
    historyEpoch,
    messageScroll,
    pinnedAroundRef,
  } = thread;
  const jumpGeneration = useRef(0);
  const [scrollRequest, setScrollRequest] = useState<{
    messageId: string;
    nonce: number;
  } | null>(null);
  const clearScrollRequest = useCallback(() => setScrollRequest(null), []);
  const initiallyScrolledThread = useRef<string | null>(null);

  async function jumpToMessage(target: JumpTarget) {
    const threadTarget = { threadId: target.threadId };
    const epoch = historyEpoch.current;
    jumpGeneration.current += 1;
    const jumpId = jumpGeneration.current;
    const [snap, page] = await Promise.all([
      rpc.threads.get(threadTarget),
      rpc.threads.messages({ ...threadTarget, around: { messageId: target.messageId } }),
    ]);
    // The epoch check drops a jump that raced a conversation clear (or a chat switch): applying
    // the fetched page would pin deleted messages that every later refresh keeps restoring.
    // jumpId drops an older jump that finished after a newer click.
    if (epoch !== historyEpoch.current || jumpId !== jumpGeneration.current) return;
    if (activeThreadId.current !== target.threadId) return;
    const messageId = target.messageId;
    const targetInPage = page.messages.some((message) => message.id === messageId);
    expandedHistoryThread.current = targetInPage ? page.threadId : null;
    pinnedAroundRef.current = targetInPage
      ? {
          messageId,
          threadId: page.threadId,
          messages: page.messages,
          olderCursor: page.olderCursor,
        }
      : null;
    if (targetInPage) initiallyScrolledThread.current = page.threadId;
    commitSnapshot({
      ...snap,
      messages: targetInPage ? page.messages : snap.messages,
      olderCursor: targetInPage ? page.olderCursor : snap.olderCursor,
    });
    commitComputer(snap.computer ?? null);
    // Don't block parent-scroll on routines metadata; a list failure must not abort the jump.
    void fetchFresh(queryClient, queries.routines.list.queryOptions({ input: threadTarget }))
      .then((routines) => {
        if (epoch !== historyEpoch.current || jumpId !== jumpGeneration.current) return;
        if (activeThreadId.current !== target.threadId) return;
        setRoutines(routines);
        setRoutinesThreadId(target.threadId);
      })
      .catch(() => undefined);
    if (targetInPage) {
      // The transcript owns the scroll: it retries until the pinned row is
      // mounted and unfollows the tail, so live commits cannot cancel it.
      setScrollRequest({ messageId, nonce: jumpId });
    } else {
      window.requestAnimationFrame(() => {
        if (epoch !== historyEpoch.current || jumpId !== jumpGeneration.current) return;
        const element = messageScroll.current;
        if (element) {
          element.scrollTop = element.scrollHeight;
          initiallyScrolledThread.current = page.threadId;
        }
      });
    }
  }

  // The routine panel copies a routine's data into local draft state at click time
  // rather than deriving it from the open chat, so it goes stale across a chat switch —
  // without this, Save in chat B could silently update chat A's routine.
  useEffect(() => {
    resetRoutineTarget();
    setPanelState((current) => (current === "routine" ? null : current));
  }, [threadId]);

  useEffect(() => {
    const messageId = searchParams.get("m");
    const routineId = searchParams.get("routine");
    if (!threadId) return;
    if (routineId && routinesThreadId === threadId) {
      const routine = routines.find((item) => item.id === routineId);
      if (routine) {
        editRoutine(routine);
        setPanel("routine");
      } else {
        setPanel("routines");
      }
      const next = new URLSearchParams(searchParams);
      next.delete("routine");
      setSearchParams(next, { replace: true });
    }
    if (messageId) {
      // Keep expandedHistoryThread; only strip the jump URL so refresh does not remount.
      void jumpToMessage({ threadId, messageId }).finally(() => {
        const next = new URLSearchParams(searchParams);
        next.delete("m");
        setSearchParams(next, { replace: true });
      });
    }
  }, [threadId, routines, routinesThreadId, searchParams, setSearchParams]);

  useLayoutEffect(() => {
    const pin = pinnedAroundRef.current;
    if (!threadId || !snapshot || snapshot.threadId !== threadId) return;
    if (initiallyScrolledThread.current === snapshot.threadId) return;
    if (expandedHistoryThread.current === snapshot.threadId) return;
    if (pin?.threadId === threadId) return;
    const element = messageScroll.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    initiallyScrolledThread.current = snapshot.threadId;
  }, [threadId, snapshot?.threadId]);

  const jumpToMessageRef = useRef(jumpToMessage);
  jumpToMessageRef.current = jumpToMessage;
  const jumpToReplyMessage = useCallback((replyId: string) => {
    const messageId = replyId;
    const inTranscript = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (inTranscript) {
      // Cancel any in-flight around-fetch so it cannot overwrite this scroll.
      jumpGeneration.current += 1;
      setScrollRequest({ messageId, nonce: jumpGeneration.current });
      return;
    }
    const threadId = activeThreadId.current;
    if (threadId) void jumpToMessageRef.current({ threadId, messageId }).catch(() => undefined);
  }, []);

  return { scrollRequest, clearScrollRequest, jumpToReplyMessage };
}
