import { accountDisplay, isRetryableError, reportUiLocale } from "@labradoodle/core";
import type { Href } from "expo-router";
import {
  Redirect,
  useFocusEffect,
  useGlobalSearchParams,
  useIsFocused,
  usePathname,
  useRouter,
} from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ViewToken } from "react-native";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  RefreshControl,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HomeErrorState } from "../components/home-error-state";
import { createHomeStyles } from "../components/home-styles";
import { InboxHeader } from "../components/inbox-header";
import { useInboxRenderItem } from "../components/inbox-render-item";
import { CompactRowsContext, SelectedChatContext } from "../components/inbox-rows";
import { NativeActionButton } from "../components/native-action-button";
import { PickChatPane } from "../components/pick-chat-pane";
import { useUnreadJumpPills } from "../components/unread-jump-overlay";
import { WorkspaceTitle } from "../components/workspace-title";
import { readableGutters } from "../lib/adaptive-layout";
import type { MobileChat, MobileMe, MobileWorkspace } from "../lib/api";
import {
  currentApiBase,
  loadSessionToken,
  rpc,
  selectedSpaceId,
  selectInitialSpace,
  signOut,
} from "../lib/api";
import {
  appBadgeGeneration,
  forgetAppBadge,
  syncInboxAppBadge,
  unreadChatCount,
} from "../lib/app-badge";
import { mobileTokens, resolveMobileAppearance } from "../lib/appearance";
import { explicitSignInRoute } from "../lib/auth-routing";
import { AvatarViewportScope, createAvatarViewport } from "../lib/avatar-life";
import { isPaywallShown } from "../lib/billing";
import { useHeaderHeightIfAny } from "../lib/floating-header";
import { useForegroundPoll } from "../lib/foreground-poll";
import { getActiveUiLocale, useI18n } from "../lib/i18n";
import { inboxItemKey, inboxSignal, selectInboxSpace } from "../lib/inbox-spaces";
import { applyUnreadOverrides } from "../lib/inbox-swipe";
import { mobileLogoAvatarActivity } from "../lib/logo-avatar-activity";
import { native, useThemedStyles } from "../lib/native";
import { iosAtLeast } from "../lib/native-controls";
import { offerPasskeyOnce } from "../lib/passkey";
import { INBOX_POLL_INTERVAL_MS } from "../lib/poll-cadence";
import { registerPushToken } from "../lib/push";
import { forgetReferrals, rememberReferral } from "../lib/referral";
import { hasSignedInBefore, rememberSignedIn } from "../lib/returning-user";
import { loadSavedInbox, saveInbox } from "../lib/saved-chats";
import {
  currentReadySessionGeneration,
  currentSessionGeneration,
  subscribeSessionGeneration,
} from "../lib/session";
import { useSplitView } from "../lib/split-view";
import { useHomeHeader } from "../lib/use-home-header";
import { useInboxChatActions } from "../lib/use-inbox-chat-actions";
import { useInboxDay } from "../lib/use-inbox-day";
import { usePublishSearchInbox } from "../lib/use-publish-search-inbox";
import type { LoadFailureKind } from "../lib/user-error";
import { errorText, loadFailureKind } from "../lib/user-error";

/** A row counts as on screen as soon as any of it shows. */
const AVATAR_VIEWABILITY = { itemVisiblePercentThreshold: 1 };
// A list narrower than this, beside an open chat, uses tighter rows.
const COMPACT_LIST_WIDTH = 360;

/** The account this launch has saved its language to (see the inbox load). */
let localeReportedFor: string | null = null;

export default function HomeRoute() {
  const { split } = useSplitView();
  return split ? <PickChatPane /> : <HomeSession />;
}

/** The chat list beside the open chat on a wide window. */
type InboxPaneProps = {
  onSelectSpace?: (spaceId: string) => void;
};

export function InboxPane({ onSelectSpace }: InboxPaneProps) {
  return <HomeSession embedded onSelectSpace={onSelectSpace} />;
}

export function HomeSession({
  embedded = false,
  onSelectSpace,
}: InboxPaneProps & { embedded?: boolean }) {
  const generation = useSyncExternalStore(subscribeSessionGeneration, currentSessionGeneration);
  const ready = useSyncExternalStore(subscribeSessionGeneration, currentReadySessionGeneration);
  return <Home key={`${generation}:${ready}`} embedded={embedded} onSelectSpace={onSelectSpace} />;
}

function Home({ embedded, onSelectSpace }: InboxPaneProps & { embedded: boolean }) {
  const tokens = mobileTokens();
  const appearance = resolveMobileAppearance();
  const styles = useThemedStyles(createHomeStyles);
  const { t } = useI18n();
  const isFocused = useIsFocused();
  const day = useInboxDay();
  const [chats, setChats] = useState<MobileChat[]>([]);
  const [workspaces, setWorkspaces] = useState<MobileWorkspace[]>([]);
  const [me, setMe] = useState<Pick<MobileMe, "userId" | "spaceId" | "name"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept apart from action errors so a failed action never borrows the load's title.
  const [inboxLoading, setInboxLoading] = useState(false);
  const [loadFailure, setLoadFailure] = useState<{ kind: LoadFailureKind; message: string } | null>(
    null,
  );
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [returningUser, setReturningUser] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const inboxRequestId = useRef(0);
  const inboxLoaded = useRef(false);
  const spaceActionRef = useRef<{ busy: boolean }>({ busy: false });
  const [spaceBusy, setSpaceBusy] = useState(false);
  const userId = me?.userId;
  const ready = sessionLoaded;

  // Only while the inbox is in front, so the offer waits until signup setup is done.
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let active = true;
      void offerPasskeyOnce(userId, () => active);
      return () => {
        active = false;
      };
    }, [userId]),
  );

  const [badgeLoad, setBadgeLoad] = useState<{ generation: number } | null>(null);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") forgetAppBadge();
    });
    return () => subscription.remove();
  }, []);

  const loadChats = useCallback(async () => {
    const badgeGeneration = appBadgeGeneration();
    if (spaceActionRef.current.busy) return;
    const requestId = ++inboxRequestId.current;
    const apiBase = currentApiBase();
    const generation = currentSessionGeneration();
    const stale = () =>
      requestId !== inboxRequestId.current ||
      generation !== currentSessionGeneration() ||
      apiBase !== currentApiBase();
    setError(null);
    setInboxLoading(true);
    try {
      const loaded = await rpc("bootstrap", {});
      if (stale()) return;
      const nextMe = loaded.me;
      if (!(await selectInitialSpace(nextMe.spaceId))) {
        throw new Error(t("Could not save the default workspace"));
      }
      if (stale()) return;
      if (!nextMe.billingEnabled) forgetReferrals();
      else {
        // Filed under the workspace it was fetched for, so a late answer never shows in another.
        const spaceId = selectedSpaceId();
        void rpc("billing/status")
          .then((billing) => {
            // Only while this session is still the live one: a reply after sign-out must not
            // restore the previous owner's link.
            if (stale()) return;
            rememberReferral(spaceId, billing.referral);
            if (billing.funding !== undefined && !billing.access && !isPaywallShown())
              router.push("/paywall");
          })
          .catch(() => undefined);
      }
      setChats(loaded.chats);
      setWorkspaces(loaded.workspaces);
      setMe(nextMe);
      // Emails follow the app's language, so the account keeps the one this app runs in. Once
      // per account and launch: polls must not undo a language picked on another device since.
      if (localeReportedFor !== nextMe.userId && nextMe.locale !== undefined) {
        localeReportedFor = nextMe.userId;
        if (nextMe.locale !== getActiveUiLocale()) {
          void reportUiLocale(getActiveUiLocale, (locale) =>
            rpc("preferences/update", { locale }),
          ).catch(() => undefined);
        }
      }
      inboxLoaded.current = true;
      setBadgeLoad({ generation: badgeGeneration });
      setLoadFailure(null);
      saveInbox(
        {
          apiBase,
          userId: nextMe.userId,
          spaceId: nextMe.spaceId,
          sessionGeneration: generation,
          selectionId: selectedSpaceId(),
        },
        { chats: loaded.chats, workspaces: loaded.workspaces },
        nextMe,
      );
      return true;
    } catch (err) {
      if (stale()) return;
      setLoadFailure({
        kind: loadFailureKind(err),
        message: errorText(err, t("Could not load chats")),
      });
      // False when the server refused rather than failed: asking again only polls it.
      return isRetryableError(err);
    } finally {
      if (requestId === inboxRequestId.current) setInboxLoading(false);
    }
  }, []);

  const refreshChats = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadChats();
    } finally {
      setRefreshing(false);
    }
  }, [loadChats]);

  useEffect(() => {
    void Promise.all([loadSessionToken(), hasSignedInBefore()]).then(([token, before]) => {
      // Sessions saved before this mark existed are recorded on their first open.
      if (token) void rememberSignedIn();
      setHasSession(Boolean(token));
      setReturningUser(before);
      setSessionLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!hasSession) return;
    void registerPushToken().catch(() => undefined);
  }, [hasSession]);

  // Show the inbox saved on this device until the first live load replaces it.
  useEffect(() => {
    if (!hasSession) return;
    let cancelled = false;
    void loadSavedInbox().then((saved) => {
      if (cancelled || !saved || inboxLoaded.current) return;
      setChats(saved.chats);
      setWorkspaces(saved.workspaces);
      setMe(saved.me);
    });
    return () => {
      cancelled = true;
    };
  }, [hasSession]);

  // The embedded pane is visible beside the chat, so it keeps polling even when
  // the chat route owns focus.
  useForegroundPoll(loadChats, INBOX_POLL_INTERVAL_MS, hasSession && (embedded || isFocused));

  const { unreadOverrides, chatAction } = useInboxChatActions({ loadChats, setChats });

  const listData = useMemo(
    () => applyUnreadOverrides(chats, unreadOverrides),
    [chats, unreadOverrides],
  );
  usePublishSearchInbox(listData, me !== null);
  const badgeCount = me
    ? unreadChatCount(listData) +
      workspaces.filter((workspace) => workspace.id !== me.spaceId && workspace.unread).length
    : null;
  useEffect(() => {
    if (badgeCount === null || badgeLoad === null) return;
    void syncInboxAppBadge(badgeCount, badgeLoad.generation);
  }, [badgeCount, badgeLoad]);
  const initials = accountDisplay(me ?? {}, t("You")).initial ?? "?";
  const insets = useSafeAreaInsets();
  // An unfolded or tablet window keeps the inbox in a centred column.
  const windowWidth = useWindowDimensions().width;
  const { inboxWidth } = useSplitView();
  const compactRows = embedded && inboxWidth < COMPACT_LIST_WIDTH;
  const columnInsets = readableGutters(embedded ? inboxWidth : windowWidth, {
    left: insets.left,
    right: embedded ? 0 : insets.right,
  });
  // Liquid Glass uses the native bar: glass bar items and a native menu.
  // The list beside a chat has no navigation bar of its own.
  const nativeHeader = iosAtLeast(26) && !embedded;
  const headerHeight = useHeaderHeightIfAny();
  const listRef = useRef<FlatList<MobileChat>>(null);
  const jumpSignals = useSyncExternalStore(
    mobileLogoAvatarActivity.subscribe,
    useMemo(() => {
      let previous: ReturnType<typeof inboxSignal>[] = [];
      return () => {
        const next = listData.map(inboxSignal);
        if (
          next.length !== previous.length ||
          next.some(
            (signal, index) =>
              signal.unread !== previous[index]?.unread ||
              signal.attention !== previous[index]?.attention,
          )
        )
          previous = next;
        return previous;
      };
    }, [listData]),
  );
  const jumpKeys = useMemo(() => listData.map(inboxItemKey), [listData]);
  const unreadJump = useUnreadJumpPills({
    signals: jumpSignals,
    keys: jumpKeys,
    listRef,
    // The Liquid Glass header floats over the list; the older header sits above it.
    topInset: nativeHeader ? headerHeight : 0,
    bottomInset: insets.bottom,
  });
  const router = useRouter();
  const pathname = usePathname();
  const openParams = useGlobalSearchParams<{ threadId?: string }>();
  const selectedChatId = pathname === "/thread" ? (openParams.threadId ?? null) : null;
  // Beside the list, a chat replaces the open one instead of stacking on it.
  const openChatRoute = useCallback(
    (href: Href) => {
      if (!embedded) router.push(href);
      else if (pathname === "/thread") router.replace(href);
      else {
        if (router.canDismiss()) router.dismissAll();
        router.push(href);
      }
    },
    [embedded, pathname, router],
  );
  const signInAgain = useCallback(async () => {
    // A rejected session cannot sign out on the server; clearing it here is what matters.
    await signOut().catch(() => undefined);
    router.replace("/sign-in");
  }, [router]);

  const chooseWorkspace = useCallback(
    async (spaceId: string) => {
      if (spaceActionRef.current.busy) return;
      spaceActionRef.current.busy = true;
      setSpaceBusy(true);
      inboxRequestId.current += 1;
      // Close a pane in another workspace before selection can change its request context.
      onSelectSpace?.(spaceId);
      try {
        const refresh = async () => {
          // A workspace seen before opens as it was saved; polling stays off until it is painted.
          const saved = await loadSavedInbox().catch(() => null);
          if (saved?.me.spaceId === spaceId) {
            setChats(saved.chats);
            setMe(saved.me);
          }
          spaceActionRef.current.busy = false;
          await refreshChats();
        };
        const selected = await selectInboxSpace(spaceId, refresh);
        if (!selected) throw new Error(t("Could not switch workspaces"));
      } catch (err) {
        const message = errorText(err, t("Could not switch workspaces"));
        setError(message);
        Alert.alert(message, t("Try again."));
      } finally {
        spaceActionRef.current.busy = false;
        setSpaceBusy(false);
      }
    },
    [refreshChats, onSelectSpace, t],
  );

  const newChat = useCallback(() => {
    if (spaceActionRef.current.busy) return;
    router.push("/new-chat");
  }, [router]);

  const title = useCallback(
    () => (
      <WorkspaceTitle
        workspaces={workspaces}
        currentId={me?.spaceId}
        disabled={spaceBusy}
        onSelect={(spaceId) => void chooseWorkspace(spaceId)}
      />
    ),
    [workspaces, me?.spaceId, spaceBusy, chooseWorkspace],
  );

  useHomeHeader({ nativeHeader, ready, hasSession, newChat, headerTitle: title });

  const openChat = useCallback(
    (chat: MobileChat) => {
      if (spaceActionRef.current.busy) return;
      openChatRoute({ pathname: "/thread", params: { threadId: chat.id } });
    },
    [openChatRoute],
  );
  const [avatarViewport] = useState(createAvatarViewport);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) =>
    avatarViewport.update(viewableItems.map((token) => token.key)),
  ).current;
  const renderItem = useInboxRenderItem({ chatAction, day, viewerUserId: userId, openChat });

  if (!ready) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={native.secondaryLabel} />
      </View>
    );
  }
  if (!hasSession) return <Redirect href={returningUser ? explicitSignInRoute : "/sign-in"} />;
  // With nothing to show, the failure takes the screen; over saved chats it stays one line.
  const showLoadFailure = Boolean(loadFailure) && listData.length === 0;
  const inlineError = error ?? (showLoadFailure ? null : (loadFailure?.message ?? null));

  return (
    <View style={styles.screen}>
      {nativeHeader ? null : (
        <InboxHeader
          initials={initials}
          newChat={newChat}
          columnInsets={columnInsets}
          title={title()}
        />
      )}

      <SelectedChatContext.Provider value={embedded ? selectedChatId : null}>
        <CompactRowsContext.Provider value={compactRows}>
          <View style={styles.listArea}>
            <AvatarViewportScope viewport={avatarViewport}>
              <FlatList<MobileChat>
                ref={listRef}
                {...unreadJump.listProps}
                style={{ flex: 1 }}
                // Rows scrolled out of view freeze their avatars until they come back.
                onViewableItemsChanged={onViewableItemsChanged}
                viewabilityConfig={AVATAR_VIEWABILITY}
                data={showLoadFailure ? [] : listData}
                keyExtractor={inboxItemKey}
                keyboardDismissMode="interactive"
                keyboardShouldPersistTaps="handled"
                indicatorStyle={appearance === "dark" ? "white" : "black"}
                contentContainerStyle={[
                  styles.list,
                  { paddingLeft: columnInsets.left, paddingRight: columnInsets.right },
                ]}
                contentInsetAdjustmentBehavior="automatic"
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={() => void refreshChats()}
                    tintColor={native.secondaryLabel}
                    colors={[tokens.mutedForeground]}
                    progressBackgroundColor={tokens.muted}
                  />
                }
                ListHeaderComponent={
                  inlineError ? <Text style={styles.error}>{inlineError}</Text> : null
                }
                ListEmptyComponent={
                  showLoadFailure && loadFailure ? (
                    <HomeErrorState
                      kind={loadFailure.kind}
                      message={loadFailure.message}
                      loading={inboxLoading && !refreshing}
                      onRetry={() => void refreshChats()}
                      onSignIn={() => void signInAgain()}
                    />
                  ) : inboxLoaded.current ? (
                    <View style={styles.emptyInbox}>
                      <NativeActionButton label={t("New chat")} onPress={newChat} />
                    </View>
                  ) : null
                }
                renderItem={renderItem}
              />
            </AvatarViewportScope>
            {refreshing || listData.length === 0 ? null : unreadJump.overlay}
          </View>
        </CompactRowsContext.Provider>
      </SelectedChatContext.Provider>
    </View>
  );
}
