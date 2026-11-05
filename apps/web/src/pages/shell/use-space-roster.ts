import type { AppBootstrap, Bot, ComputerStatus, Group, Me, Space } from "@labradoodle/contracts";
import { isRetryableError } from "@labradoodle/core";
import { replaceEqualDeep } from "@tanstack/react-query";
import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { takeInitialBootstrap } from "../../lib/bootstrap";
import { linkedBotRoute } from "../../lib/bootstrap-target";
import { localTimezone } from "../../lib/local-timezone";
import { markOnce } from "../../lib/performance";
import type { ChatTarget } from "../../lib/query";
import { lastChatKey, queryClient, seedOnLeave, spaceSeedKey } from "../../lib/query";
import type { createSpaceRpc } from "../../lib/rpc";
import type { useShellNavigation } from "./use-shell-navigation";
import { firstThreadRoute } from "./use-shell-navigation";
import type { ThreadState } from "./use-thread-state";

type Navigation = ReturnType<typeof useShellNavigation>;

/** The space's bots, groups and spaces, refreshed while the shell is open. */
export function useSpaceRoster({
  rpc,
  seed,
  botId,
  groupId,
  navigate,
  redirectKeepingOverlay,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  seed: AppBootstrap | undefined;
  botId: string | undefined;
  groupId: string | undefined;
  navigate: Navigation["navigate"];
  redirectKeepingOverlay: Navigation["redirectKeepingOverlay"];
}) {
  const [groups, setGroups] = useState<Group[]>(seed?.groups ?? []);
  const [bots, setBots] = useState<Bot[]>(seed?.bots ?? []);
  const botsRef = useRef(bots);
  botsRef.current = bots;
  const [spaces, setSpaces] = useState<Space[]>(seed?.spaces ?? []);
  const [initialBotsLoaded, setInitialBotsLoaded] = useState(Boolean(seed));
  // A failed first load falls back to the shell, whose polling and footer can still recover.
  const [initialLoadFailed, setInitialLoadFailed] = useState(false);
  const [bootstrapMe, setBootstrapMe] = useState<Me | null | undefined>(seed?.me);
  const botsRefreshEpoch = useRef(0);
  const botsRefreshApplied = useRef(0);
  const botsRefreshInFlight = useRef(0);
  const routeBotId = useRef<string | undefined>(botId);
  routeBotId.current = botId;
  const routeGroupId = useRef<string | undefined>(groupId);
  routeGroupId.current = groupId;

  /** `mayBeEmpty` checks for onboarding after a change that can remove the last chat. */
  const refreshBots = useCallback(
    async (mayBeEmpty = false) => {
      markOnce("rk:renderer:bots-request-start");
      const request = ++botsRefreshEpoch.current;
      botsRefreshInFlight.current += 1;
      try {
        const navigation = await rpc.spaces.list();
        const { bots: list, groups: groupList } = navigation.current;
        markOnce("rk:renderer:bots-response");
        if (request !== botsRefreshEpoch.current) return;
        // The roster is polled; keeping unchanged values lets an unchanged poll skip rendering.
        setBots((previous) => replaceEqualDeep(previous, list));
        setGroups((previous) => replaceEqualDeep(previous, groupList));
        setSpaces((previous) => replaceEqualDeep(previous, navigation.spaces));
        setInitialBotsLoaded(true);
        botsRefreshApplied.current = request;
        if (
          mayBeEmpty &&
          list.length === 0 &&
          groupList.length === 0 &&
          !navigation.spaces.some((space) => space.hasContent)
        ) {
          // Only the very first bot everywhere needs onboarding. An empty
          // current space with content elsewhere stays in the app so the
          // space can be switched to or deleted instead of trapping the user.
          navigate("/onboarding", { replace: true });
          return;
        }
        const currentGroupId = routeGroupId.current;
        if (currentGroupId) {
          if (!groupList.some((group) => group.id === currentGroupId)) {
            redirectKeepingOverlay(firstThreadRoute(list, groupList));
          }
          return;
        }
        const currentBotId = routeBotId.current;
        if (!currentBotId || !list.some((bot) => bot.id === currentBotId)) {
          redirectKeepingOverlay(firstThreadRoute(list, groupList));
        }
      } finally {
        botsRefreshInFlight.current -= 1;
      }
    },
    [navigate],
  );

  /** Shows a bot created here at once: a roster requested before creation may omit it. */
  function addCreatedBot(bot: Bot) {
    botsRefreshEpoch.current += 1;
    setBots((current) =>
      current.some((item) => item.id === bot.id) ? current : [bot, ...current],
    );
  }

  return {
    groups,
    setGroups,
    bots,
    setBots,
    botsRef,
    spaces,
    setSpaces,
    initialBotsLoaded,
    setInitialBotsLoaded,
    initialLoadFailed,
    setInitialLoadFailed,
    bootstrapMe,
    setBootstrapMe,
    botsRefreshApplied,
    botsRefreshInFlight,
    routeBotId,
    routeGroupId,
    refreshBots,
    addCreatedBot,
  };
}

export type SpaceRoster = ReturnType<typeof useSpaceRoster>;

/**
 * Loads the space's bootstrap, keeps the roster polled, and saves what the shell showed so a
 * revisit paints at once.
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
  botId,
  groupId,
  chat,
  navigate,
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
  botId: string | undefined;
  groupId: string | undefined;
  chat: ChatTarget | undefined;
  navigate: Navigation["navigate"];
  redirectKeepingOverlay: Navigation["redirectKeepingOverlay"];
  /** Opens a linked bot that lives in another of the user's Spaces. */
  openSpaceChat: RefObject<(spaceId: string, path: string) => void>;
}) {
  const {
    bots,
    setBots,
    groups,
    setGroups,
    spaces,
    setSpaces,
    setInitialBotsLoaded,
    setInitialLoadFailed,
    bootstrapMe,
    setBootstrapMe,
    botsRefreshApplied,
    botsRefreshInFlight,
    routeBotId,
    routeGroupId,
    refreshBots,
  } = roster;
  const { snapshotRef, commitSnapshot, setRoutines, setRoutinesBotId, bootstrappedThread } = thread;
  // Until the route names the chat reopened from cache, that chat stands in for it.
  const routeChat = botId || groupId ? undefined : startChat;

  function saveSeed(bootstrap: AppBootstrap, chat?: ChatTarget) {
    // With no space chosen the server picks one, so a shell reopened that way looks there too.
    for (const spaceId of shellSpaceId ? [bootstrap.me.spaceId] : [bootstrap.me.spaceId, null]) {
      queryClient.setQueryData(spaceSeedKey(userId ?? null, spaceId), bootstrap);
      if (chat) queryClient.setQueryData(lastChatKey(userId ?? null, spaceId), chat);
    }
  }
  const seedStateRef = useRef<
    | (Omit<AppBootstrap, "thread" | "routines" | "me"> & {
        me?: Me | null;
        chat: ChatTarget | undefined;
      })
    | null
  >(null);
  seedStateRef.current = {
    chat,
    me: bootstrapMe,
    bots,
    groups,
    spaces,
  };
  useLayoutEffect(() => {
    if (routeChat) {
      redirectKeepingOverlay(
        routeChat.groupId ? `/app/g/${routeChat.groupId}` : `/app/${routeChat.botId}`,
      );
    }
    // Leaving for another page or space keeps the sidebar and open chat to reopen with.
    return () => {
      const state = seedStateRef.current;
      if (!state?.me) return;
      const { me, chat, ...lists } = state;
      const previous = queryClient.getQueryData(spaceSeedKey(userId ?? null, me.spaceId));
      if (!previous) return;
      saveSeed(seedOnLeave(previous, { ...lists, me }, chat, snapshotRef.current), chat);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const appliedAtStart = botsRefreshApplied.current;
    void takeInitialBootstrap(botId ?? startChat?.botId)
      .then((bootstrap) => {
        // Kept for the space it belongs to, so switching back to it can paint at once.
        saveSeed(bootstrap);
        if (cancelled) return;
        const groupList = bootstrap.groups;
        setBootstrapMe(bootstrap.me);
        // First sign-in with no saved timezone: adopt this browser's, once. A choice made
        // in Settings is never overwritten; a failure just leaves bots on UTC.
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
        // Skip list/route writes only if a later refreshBots() successfully
        // committed (failed refreshes bump epoch but not botsRefreshApplied).
        const applyBotLists = appliedAtStart === botsRefreshApplied.current;
        if (applyBotLists) {
          setBots(bootstrap.bots);
          setGroups(groupList);
          setSpaces(bootstrap.spaces);
          setInitialBotsLoaded(true);
        }
        // A seeded shell already loads its chat live; this older copy must not replace it.
        if (!seed && !groupId && bootstrap.thread) {
          bootstrappedThread.current = bootstrap.thread;
          commitSnapshot(bootstrap.thread);
          commitComputer(bootstrap.thread.computer ?? null);
          setRoutines(bootstrap.routines);
          setRoutinesBotId(bootstrap.thread.botId ?? null);
          markOnce("rk:renderer:bots-response");
          markOnce("rk:renderer:thread-response");
        }
        // Checked before the roster gate: a refresh that landed first may already have moved away.
        const linked = groupId
          ? undefined
          : linkedBotRoute(bootstrap, botId, window.location.search);
        if (linked) {
          openSpaceChat.current(linked.spaceId, linked.path);
          return;
        }
        if (!applyBotLists) return;
        // A shell that reopened from cache is already on a chat; it moves only if that chat is gone.
        if (
          seed &&
          (routeGroupId.current
            ? groupList.some((group) => group.id === routeGroupId.current)
            : bootstrap.bots.some((bot) => bot.id === routeBotId.current))
        ) {
          return;
        }
        if (
          bootstrap.bots.length === 0 &&
          groupList.length === 0 &&
          !bootstrap.spaces.some((space) => space.hasContent)
        ) {
          navigate("/onboarding", { replace: true });
          return;
        }
        if (groupId) {
          if (!groupList.some((group) => group.id === groupId)) {
            redirectKeepingOverlay(firstThreadRoute(bootstrap.bots, groupList));
          }
          return;
        }
        const selectedBotId = bootstrap.thread?.botId ?? bootstrap.bots[0]?.id;
        if (selectedBotId && selectedBotId !== botId) {
          redirectKeepingOverlay(`/app/${selectedBotId}`);
        }
      })
      .catch(() => {
        if (cancelled) return;
        if (!seed) setBootstrapMe(null);
        void refreshBots(true).catch(() => {
          if (!cancelled) setInitialLoadFailed(true);
        });
      });
    let refreshTimer: number | undefined;
    const refreshVisibleBots = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(
        () =>
          void refreshBots().catch((error) => {
            if (!isRetryableError(error)) window.clearInterval(poll);
          }),
        50,
      );
    };
    window.addEventListener("focus", refreshVisibleBots);
    document.addEventListener("visibilitychange", refreshVisibleBots);
    // Poll skips while a refresh is in flight; focus/visibility and event-driven
    // callers still bump botsRefreshEpoch so only the latest response applies.
    const poll = window.setInterval(() => {
      if (botsRefreshInFlight.current > 0) return;
      refreshVisibleBots();
    }, 3_000);
    return () => {
      cancelled = true;
      window.clearTimeout(refreshTimer);
      window.clearInterval(poll);
      window.removeEventListener("focus", refreshVisibleBots);
      document.removeEventListener("visibilitychange", refreshVisibleBots);
    };
  }, []);
}
