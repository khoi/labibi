import type { Chat } from "@labradoodle/contracts";
import type { ReadBoundary } from "@labradoodle/core";
import { createChatQueues, settleReadBoundary } from "@labradoodle/core";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { autoReadStillWanted } from "../../lib/auto-read";
import type { createSpaceRpc } from "../../lib/rpc";

/**
 * Read state for the open chat: automatic reads while it is visible, Mark as Unread holds,
 * and the "New" divider that marks where the person had read up to.
 */
export function useChatRead({
  rpc,
  threadId,
  setChats,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  threadId: string | undefined;
  setChats: Dispatch<SetStateAction<Chat[]>>;
}) {
  const manuallyUnread = useRef(new Set<string>());
  const [markedUnread, setMarkedUnread] = useState<{ visit: number; messageId: string } | null>(
    null,
  );
  // What the person had read up to when the open chat was opened; the "New" divider
  // follows it until they write in the chat or leave it. Each open of a chat is a new visit.
  const readVisit = useRef<{ chat: string | null; visit: number }>({ chat: null, visit: 0 });
  const [readBoundary, setReadBoundary] = useState<ReadBoundary | null>(null);
  // A chat's markRead calls run one at a time so the request that opened it answers first.
  const [readInOrder] = useState(createChatQueues);
  const openChat = threadId ?? null;
  if (readVisit.current.chat !== openChat) {
    readVisit.current = { chat: openChat, visit: readVisit.current.visit + 1 };
  }
  const captureReadBoundary = useCallback((visit: number, seq: number | null) => {
    setReadBoundary((current) =>
      settleReadBoundary(current, readVisit.current.visit, { visit, seq }),
    );
  }, []);
  // Writing in the chat means the person has caught up, so the divider goes.
  const clearReadBoundary = useCallback(() => {
    setReadBoundary({ visit: readVisit.current.visit, seq: null });
  }, []);
  const updateUnread = useCallback((id: string, unread: boolean) => {
    setChats((current) => {
      const chat = current.find((candidate) => candidate.id === id);
      if (!chat || chat.unread === unread) return current;
      return current.map((candidate) =>
        candidate.id === id ? { ...candidate, unread } : candidate,
      );
    });
  }, []);
  // `stillWanted` makes it an automatic read: one that waited in the queue skips once the person
  // has left. Only an explicit read clears a Mark as Unread hold, and it does so up front, so an
  // automatic read answering after the person marked the chat unread can't undo the hold.
  const markRead = useCallback(
    async (id: string, stillWanted?: () => boolean) => {
      if (!stillWanted) {
        manuallyUnread.current.delete(id);
        if (readVisit.current.chat === id) setMarkedUnread(null);
      }
      const answer = await readInOrder(id, () =>
        !stillWanted || stillWanted()
          ? rpc.threads.markRead({ threadId: id })
          : Promise.resolve(null),
      );
      if (!answer) return undefined;
      if (!manuallyUnread.current.has(id)) updateUnread(id, false);
      return answer.unreadAfterSeq;
    },
    [readInOrder, updateUnread],
  );
  const markUnread = useCallback(
    async (id: string, messageId?: string) => {
      manuallyUnread.current.add(id);
      const visit = readVisit.current.visit;
      try {
        // Through the chat's read queue, so a read already sent lands first and this one wins.
        await readInOrder(id, () =>
          rpc.threads.markUnread({ threadId: id, ...(messageId ? { messageId } : {}) }),
        );
      } catch (err) {
        manuallyUnread.current.delete(id);
        throw err;
      }
      if (messageId && readVisit.current.visit === visit) setMarkedUnread({ visit, messageId });
      updateUnread(id, true);
    },
    [readInOrder, updateUnread],
  );
  // A chat the person marked unread by hand stays unread until they open it again,
  // otherwise the auto-read below would undo the action on the next window focus.
  const markReadIfVisible = useCallback(
    (id: string) => {
      if (manuallyUnread.current.has(id)) return;
      if (document.visibilityState === "visible" && document.hasFocus()) {
        const visit = readVisit.current.visit;
        void markRead(
          id,
          () =>
            !manuallyUnread.current.has(id) && autoReadStillWanted(readVisit.current.visit, visit),
        )
          .then((seq) => {
            if (seq !== undefined) captureReadBoundary(visit, seq);
          })
          .catch(() => undefined);
      }
    },
    [markRead, captureReadBoundary],
  );

  useEffect(() => {
    if (!threadId) return;
    // Opening a chat clears the manual unread flag so it can auto-read again.
    manuallyUnread.current.delete(threadId);
    const markVisibleRead = () => markReadIfVisible(threadId);
    markVisibleRead();
    window.addEventListener("focus", markVisibleRead);
    document.addEventListener("visibilitychange", markVisibleRead);
    return () => {
      window.removeEventListener("focus", markVisibleRead);
      document.removeEventListener("visibilitychange", markVisibleRead);
    };
  }, [threadId, markReadIfVisible]);

  const markedUnreadMessageId =
    markedUnread?.visit === readVisit.current.visit && manuallyUnread.current.has(threadId ?? "")
      ? markedUnread.messageId
      : undefined;
  const unreadAfterSeq = readBoundary?.visit === readVisit.current.visit ? readBoundary.seq : null;

  return {
    clearReadBoundary,
    markRead,
    markUnread,
    markReadIfVisible,
    markedUnreadMessageId,
    unreadAfterSeq,
  };
}
