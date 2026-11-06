import type {
  AppBootstrap,
  Chat,
  ComputerStatus,
  Doodle,
  Me,
  Workspace,
} from "@labradoodle/contracts";
import { isRetryableError } from "@labradoodle/core";
import { replaceEqualDeep } from "@tanstack/react-query";
import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { takeInitialBootstrap } from "../../lib/bootstrap";
import { chatPath, linkedChatRoute } from "../../lib/bootstrap-target";
import { localTimezone } from "../../lib/local-timezone";
import { markOnce } from "../../lib/performance";
import type { ChatTarget } from "../../lib/query";
import { lastChatKey, queryClient, seedOnLeave, spaceSeedKey } from "../../lib/query";
import type { createSpaceRpc } from "../../lib/rpc";
import type { useShellNavigation } from "./use-shell-navigation";
import { firstThreadRoute } from "./use-shell-navigation";
import type { ThreadState } from "./use-thread-state";

type Navigation = ReturnType<typeof useShellNavigation>;

/** The workspace's chats, the person's workspaces and its Doodle, refreshed while the shell is open. */
export function useSpaceRoster({
  rpc,
  seed,
  threadId,
  redirectKeepingOverlay,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  seed: AppBootstrap | undefined;
  threadId: string | undefined;
  redirectKeepingOverlay: Navigation["redirectKeepingOverlay"];
}) {
  const [chats, setChats] = useState<Chat[]>(seed?.chats ?? []);
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const [workspaces, setWorkspaces] = useState<Workspace[]>(seed?.workspaces ?? []);
  const [doodle, setDoodle] = useState<Doodle | null>(seed?.doodle ?? null);
  const [initialChatsLoaded, setInitialChatsLoaded] = useState(Boolean(seed));
  // A failed first load falls back to the shell, whose polling and footer can still recover.
  const [initialLoadFailed, setInitialLoadFailed] = useState(false);
  const [bootstrapMe, setBootstrapMe] = useState<Me | null | undefined>(seed?.me);
  const refreshEpoch = useRef(0);
  const refreshApplied = useRef(0);
  const refreshInFlight = useRef(0);
  const routeThreadId = useRef<string | undefined>(threadId);
  routeThreadId.current = threadId;

  const refreshChats = useCallback(async () => {
    markOnce("rk:renderer:bots-request-start");
    const request = ++refreshEpoch.current;
    refreshInFlight.current += 1;
    try {
      const [list, workspaceList] = await Promise.all([rpc.threads.list(), rpc.spaces.list()]);
      markOnce("rk:renderer:bots-response");
      if (request !== refreshEpoch.current) return;
      // The list is polled; keeping unchanged values lets an unchanged poll skip rendering.
      setChats((previous) => replaceEqualDeep(previous, list));
      setWorkspaces((previous) => replaceEqualDeep(previous, workspaceList));
      setInitialChatsLoaded(true);
      refreshApplied.current = request;
      const current = routeThreadId.current;
      if (current ? !list.some((chat) => chat.id === current) : list.length > 0) {
        redirectKeepingOverlay(firstThreadRoute(list));
      }
    } finally {
      refreshInFlight.current -= 1;
    }
  }, []);

  const refreshDoodle = useCallback(async () => {
    const next = await rpc.doodle.get();
    setDoodle((current) => replaceEqualDeep(current, next));
  }, []);

  /** Shows a chat made or changed here at once: a list requested before it may omit it. */
  const applyChat = useCallback((chat: Chat) => {
    refreshEpoch.current += 1;
    setChats((current) =>
      current.some((item) => item.id === chat.id)
        ? current.map((item) => (item.id === chat.id ? chat : item))
        : [chat, ...current],
    );
  }, []);

  /** Drops a chat this person left or deleted, ahead of the next list. */
  const removeChat = useCallback((id: string) => {
    refreshEpoch.current += 1;
    setChats((current) => current.filter((chat) => chat.id !== id));
  }, []);

  return {
    chats,
    setChats,
    chatsRef,
    workspaces,
    setWorkspaces,
    doodle,
    setDoodle,
    initialChatsLoaded,
    setInitialChatsLoaded,
    initialLoadFailed,
    setInitialLoadFailed,
    bootstrapMe,
    setBootstrapMe,
    refreshApplied,
    refreshInFlight,
    routeThreadId,
    refreshChats,
    refreshDoodle,
    applyChat,
    removeChat,
  };
}

export type SpaceRoster = ReturnType<typeof useSpaceRoster>;

/**
 * Loads the workspace's bootstrap, keeps the chat list polled, and saves what the shell showed so
 * a revisit paints at once.
 */
export function useSpaceBootstrap({
  rpc,
  roster,
  thread,
  commitComputer,
  userId,
  shellSpaceId,
  seed,
  startChat,
  threadId,
  redirectKeepingOverlay,
  openSpaceChat,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  roster: SpaceRoster;
  thread: ThreadState;
  commitComputer: (next: ComputerStatus | null) => void;
  userId: string | undefined;
  shellSpaceId: string | null;
  seed: AppBootstrap | undefined;
  startChat: ChatTarget | undefined;
  threadId: string | undefined;
  redirectKeepingOverlay: Navigation["redirectKeepingOverlay"];
  /** Opens a linked chat that lives in another of the person's workspaces. */
  openSpaceChat: RefObject<(spaceId: string, path: string) => void>;
}) {
  const {
    chats,
    setChats,
    workspaces,
    setWorkspaces,
    doodle,
    setDoodle,
    setInitialChatsLoaded,
    setInitialLoadFailed,
    bootstrapMe,
    setBootstrapMe,
    refreshApplied,
    refreshInFlight,
    routeThreadId,
    refreshChats,
  } = roster;
  const { snapshotRef, commitSnapshot, bootstrappedThread } = thread;
  // Until the route names the chat reopened from cache, that chat stands in for it.
  const routeChat = threadId ? undefined : startChat;
  const chat: ChatTarget | undefined = threadId ? { threadId } : startChat;

  function saveSeed(bootstrap: AppBootstrap, chat?: ChatTarget) {
    // With no workspace chosen the server picks one, so a shell reopened that way looks there too.
    for (const spaceId of shellSpaceId ? [bootstrap.me.spaceId] : [bootstrap.me.spaceId, null]) {
      queryClient.setQueryData(spaceSeedKey(userId ?? null, spaceId), bootstrap);
      if (chat) queryClient.setQueryData(lastChatKey(userId ?? null, spaceId), chat);
    }
  }
  const seedStateRef = useRef<{
    me?: Me | null;
    doodle: Doodle | null;
    chat: ChatTarget | undefined;
    chats: Chat[];
    workspaces: Workspace[];
  } | null>(null);
  seedStateRef.current = { chat, me: bootstrapMe, doodle, chats, workspaces };
  useLayoutEffect(() => {
    if (routeChat) redirectKeepingOverlay(chatPath(routeChat.threadId));
    // Leaving for another page or workspace keeps the list and open chat to reopen with.
    return () => {
      const state = seedStateRef.current;
      if (!state?.me || !state.doodle) return;
      const { me, doodle, chat, ...lists } = state;
      const previous = queryClient.getQueryData(spaceSeedKey(userId ?? null, me.spaceId));
      if (!previous) return;
      saveSeed(seedOnLeave(previous, { ...lists, me, doodle }, chat, snapshotRef.current), chat);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const appliedAtStart = refreshApplied.current;
    void takeInitialBootstrap(threadId ?? startChat?.threadId)
      .then((bootstrap) => {
        // Kept for the workspace it belongs to, so switching back to it can paint at once.
        saveSeed(bootstrap);
        if (cancelled) return;
        setBootstrapMe(bootstrap.me);
        setDoodle(bootstrap.doodle);
        // First sign-in with no saved timezone: adopt this browser's, once. A choice made
        // in Settings is never overwritten; a failure just leaves routines on UTC.
        if (bootstrap.me.timezone === null) {
          void rpc.preferences
            .adoptTimezone({ timezone: localTimezone() })
            .then((nextMe) => {
              if (!cancelled) {
                setBootstrapMe((current) =>
                  current && current.timezone == null
                    ? { ...current, timezone: nextMe.timezone }
                    : (current ?? nextMe),
                );
              }
            })
            .catch(() => {});
        }
        // Skip list/route writes only if a later refreshChats() successfully committed.
        const applyLists = appliedAtStart === refreshApplied.current;
        if (applyLists) {
          setChats(bootstrap.chats);
          setWorkspaces(bootstrap.workspaces);
          setInitialChatsLoaded(true);
        }
        // A seeded shell already loads its chat live; this older copy must not replace it.
        if (!seed && bootstrap.thread) {
          bootstrappedThread.current = bootstrap.thread;
          commitSnapshot(bootstrap.thread);
          commitComputer(bootstrap.thread.computer ?? null);
          markOnce("rk:renderer:bots-response");
          markOnce("rk:renderer:thread-response");
        }
        // Checked before the list gate: a refresh that landed first may already have moved away.
        const linked = linkedChatRoute(bootstrap, threadId, window.location.search);
        if (linked) {
          openSpaceChat.current(linked.spaceId, linked.path);
          return;
        }
        if (!applyLists) return;
        const current = routeThreadId.current;
        // A shell that reopened from cache is already on a chat; it moves only if that chat is gone.
        if (current && bootstrap.chats.some((item) => item.id === current)) return;
        const selected = bootstrap.thread?.threadId ?? bootstrap.chats[0]?.id;
        if (selected && selected !== current) redirectKeepingOverlay(chatPath(selected));
        else if (!selected && current) redirectKeepingOverlay("/app");
      })
      .catch(() => {
        if (cancelled) return;
        if (!seed) setBootstrapMe(null);
        void Promise.all([refreshChats(), roster.refreshDoodle()]).catch(() => {
          if (!cancelled) setInitialLoadFailed(true);
        });
      });
    let refreshTimer: number | undefined;
    const refreshVisibleChats = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(
        () =>
          void refreshChats().catch((error) => {
            if (!isRetryableError(error)) window.clearInterval(poll);
          }),
        50,
      );
    };
    window.addEventListener("focus", refreshVisibleChats);
    document.addEventListener("visibilitychange", refreshVisibleChats);
    // Poll skips while a refresh is in flight; focus/visibility and event-driven
    // callers still bump the epoch so only the latest response applies.
    const poll = window.setInterval(() => {
      if (refreshInFlight.current > 0) return;
      refreshVisibleChats();
    }, 3_000);
    return () => {
      cancelled = true;
      window.clearTimeout(refreshTimer);
      window.clearInterval(poll);
      window.removeEventListener("focus", refreshVisibleChats);
      document.removeEventListener("visibilitychange", refreshVisibleChats);
    };
  }, []);
}
