import type {
  AgentSkillCatalogEntry,
  Chat,
  SpaceMemoryConfig,
  ThreadMessage,
  VoiceStatus,
  Workspace,
} from "@labradoodle/contracts";
import {
  answerableAskMessageIds,
  DOODLE_NAME,
  dismissableAskMessageIds,
  isActive,
  isRunWorking,
  otherAuthor,
} from "@labradoodle/core";
import { useIsMobile } from "@labradoodle/ui-web/hooks/use-mobile";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Keyboard, Monitor, Moon, Plug, ScrollText, SquarePen, Sun } from "lucide-react";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useParams } from "react-router-dom";
import { ComputerUpdateProgress } from "../components/ComputerUpdateProgress";
import { PageLoading } from "../components/PageLoading";
import { PageViewHost } from "../components/pages/PageViewHost";
import type { ArtifactTarget } from "../lib/artifact-open";
import { authClient } from "../lib/auth";
import { peekBootstrapSeed } from "../lib/bootstrap";
import { chatPath } from "../lib/bootstrap-target";
import type { BotsSidebarDensity } from "../lib/bots-sidebar-density-pref";
import {
  getBotsSidebarDensity,
  subscribeBotsSidebarDensity,
} from "../lib/bots-sidebar-density-pref";
import { readBotsSidebarCollapsed, writeBotsSidebarCollapsed } from "../lib/bots-sidebar-pref";
import {
  getComposerEnterToSend,
  subscribeComposerEnterToSend,
} from "../lib/composer-enter-to-send-pref";
import { desktopBridge } from "../lib/desktop";
import { hasOpenDialog } from "../lib/has-open-dialog";
import { PagesProvider, usePagesForChat } from "../lib/pages";
import { markAfterPaint, markOnce } from "../lib/performance";
import { lastChatKey, lastChatOf, queryClient, spaceQueries, spaceSeedKey } from "../lib/query";
import { createSpaceRpc, selectedSpaceId, selectSpace } from "../lib/rpc";
import { markShellReady, useSpaceEpoch } from "../lib/space-switch";
import { activeThreadRuns } from "../lib/thread-events";
import { getToolActivityEnabled, subscribeToolActivity } from "../lib/tool-activity-preference";
import type { AppearancePreference } from "../lib/ui-appearance";
import { getUiAppearancePreference, setUiAppearance } from "../lib/ui-appearance";
import { useDesktopBadge } from "../lib/use-desktop-badge";
import { HostComputerPrompt } from "./HostComputerPrompt";
import { RoutineList } from "./RoutineEditor";
import { useSettingsNavItems } from "./settings-nav";
import { ChatFindBar } from "./shell/chat-find-bar";
import { ChatHeader } from "./shell/chat-header";
import { ChatList, soloChat } from "./shell/chat-list";
import type { CommandPaletteAction } from "./shell/command-palette";
import { Composer } from "./shell/composer";
import { ComputerOverlay } from "./shell/computer-overlay";
import { KeyboardShortcutsDialog } from "./shell/keyboard-shortcuts-dialog";
import { NewChatDialog } from "./shell/new-chat-dialog";
import { ShellDialogs, useShellDialogs } from "./shell/shell-dialogs";
import { AppOverlays, SettingsOverlays } from "./shell/shell-overlays";
import { cycleBotId, isApplePlatform, useShellShortcuts } from "./shell/shell-shortcuts";
import { focusSidebarSearch, ShellSidebar } from "./shell/shell-sidebar";
import { ShellSidePanel, useWorkspaceMembers } from "./shell/side-panel";
import { WorkspaceSwitcher } from "./shell/sidebar-header";
import { BotsSidebarLayout } from "./shell/sidebar-layout";
import { Transcript } from "./shell/transcript";
import { useBrowserNotifications } from "./shell/use-browser-notifications";
import { useChatRead } from "./shell/use-chat-read";
import { useComposerActions } from "./shell/use-composer-actions";
import { useComposerMentions } from "./shell/use-composer-mentions";
import { useComputerControls, useComputerState } from "./shell/use-computer";
import { useMessageJump } from "./shell/use-message-jump";
import { useMobileSidebar } from "./shell/use-mobile-sidebar";
import { useReadAloud } from "./shell/use-read-aloud";
import { useReportedUiLocale } from "./shell/use-reported-ui-locale";
import { useRightPanel, useRightPanelRestore } from "./shell/use-right-panel";
import { useRoutineEditor } from "./shell/use-routine-editor";
import { firstThreadRoute, useShellNavigation } from "./shell/use-shell-navigation";
import { useSidebarSearch } from "./shell/use-sidebar-search";
import { useSpaceBootstrap, useSpaceRoster } from "./shell/use-space-roster";
import { useOpenSpaceChat } from "./shell/use-space-switch";
import { useThreadState } from "./shell/use-thread-state";
import { useThreadSync } from "./shell/use-thread-sync";
import type { SettingsSection } from "./shell-overlay";

const NO_AGENT_SKILLS: AgentSkillCatalogEntry[] = [];

export function ShellPage() {
  // A new key per workspace switch, so nothing from the previous workspace survives it.
  const spaceEpoch = useSpaceEpoch();
  return <SpaceShell key={spaceEpoch} />;
}

function SpaceShell() {
  const { t } = useLingui();
  const { threadId } = useParams();
  const [shellSpaceId] = useState(selectedSpaceId);
  const [rpc] = useState(() => createSpaceRpc(shellSpaceId));
  const session = authClient.useSession();
  const userId = session.data?.user.id;
  // Held from the first render, so Cmd/Ctrl+N works before the sidebar has data.
  const [newChatOpen, setNewChatOpen] = useState(false);
  // A revisited workspace, or the shell reopened from another page, starts from what it showed
  // last time while its fresh bootstrap loads.
  const [{ seed, startChat }] = useState(() => {
    const primed = peekBootstrapSeed(threadId);
    if (primed) return { seed: primed, startChat: undefined };
    const cached = queryClient.getQueryData(spaceSeedKey(userId ?? null, shellSpaceId));
    const lastChat = queryClient.getQueryData(lastChatKey(userId ?? null, shellSpaceId));
    return { seed: cached, startChat: threadId ? undefined : lastChatOf(cached, lastChat) };
  });
  const {
    navigate,
    navigationRevision,
    overlayRevision,
    searchParams,
    setSearchParams,
    searchParamsRef,
    redirectKeepingOverlay,
    overlay,
    setOverlay,
  } = useShellNavigation();
  const queries = spaceQueries(userId ?? null, shellSpaceId);
  const roster = useSpaceRoster({ rpc, seed, threadId, redirectKeepingOverlay });
  const {
    chats,
    setChats,
    workspaces,
    doodle,
    initialChatsLoaded,
    initialLoadFailed,
    bootstrapMe,
    setBootstrapMe,
    refreshChats,
    refreshDoodle,
    applyChat,
    removeChat,
  } = roster;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    setSidebarCollapsed(readBotsSidebarCollapsed(userId));
  }, [userId]);
  const search = useSidebarSearch({ rpc, navigate });
  const thread = useThreadState();
  const { snapshot } = thread;
  const showToolActivity = useSyncExternalStore(
    subscribeToolActivity,
    getToolActivityEnabled,
    () => true,
  );
  const sidebarDensity = useSyncExternalStore<BotsSidebarDensity>(
    subscribeBotsSidebarDensity,
    getBotsSidebarDensity,
    () => "comfortable",
  );
  const enterToSend = useSyncExternalStore(
    subscribeComposerEnterToSend,
    getComposerEnterToSend,
    () => false,
  );
  const rightPanel = useRightPanel({ searchParams, setSearchParams });
  const { panel, setPanel } = rightPanel;
  const lastChatTab = useRef<"files" | "memory" | "routines">("files");
  if (panel === "files" || panel === "memory" || panel === "routines") lastChatTab.current = panel;
  const agentSkillsQuery = useQuery(queries.agentSkills.list.queryOptions());
  const agentSkills = agentSkillsQuery.data ?? NO_AGENT_SKILLS;
  const refreshAgentSkills = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queries.agentSkills.list.queryKey() });
  }, [queries]);
  const [teachBusy, setTeachBusy] = useState(false);
  const memoryConfigQuery = useQuery(queries.memory.providerConfig.queryOptions());
  // Undefined while it first loads; null when the workspace has none or it could not be read.
  const memoryProviderConfig: SpaceMemoryConfig | null | undefined =
    memoryConfigQuery.data !== undefined
      ? memoryConfigQuery.data
      : memoryConfigQuery.isError
        ? null
        : undefined;
  const voiceStatus: VoiceStatus | null =
    useQuery(queries.voice.status.queryOptions()).data ?? null;
  const readAloud = useQuery(queries.me.queryOptions()).data?.readAloud ?? bootstrapMe?.readAloud;
  const { mobileSidebarOpen, setMobileSidebarOpen, swipeHandlers } = useMobileSidebar();
  const isMobileSidebar = useIsMobile();
  const pages = usePagesForChat();
  const miniSidebar = sidebarCollapsed && !isMobileSidebar;
  const currentSpaceId = selectedSpaceId() ?? bootstrapMe?.spaceId ?? null;
  const workspaceMembers = useWorkspaceMembers(currentSpaceId ?? undefined);
  // null: settings follow the workspace the app is showing.
  const settingsSpaceId = overlay?.kind === "settings" ? overlay.spaceId : null;
  const settingsSpace =
    workspaces.find((workspace) => workspace.id === (settingsSpaceId ?? currentSpaceId)) ?? null;
  // Never fall back to another workspace's settings when the edited one goes away.
  const settingsSpaceGone = initialChatsLoaded && settingsSpaceId !== null && !settingsSpace;
  useEffect(() => {
    if (settingsSpaceGone) setOverlay(null);
  }, [settingsSpaceGone]);
  // The app menu owns Cmd+, because macOS takes it before the page sees a keydown.
  const openSettingsRef = useRef(openSettings);
  openSettingsRef.current = openSettings;
  useEffect(() => desktopBridge()?.settings?.onOpen(() => openSettingsRef.current("general")), []);

  const chatPanelOpen = panel !== null;
  // Until the route names the chat reopened from cache, that chat stands in for it.
  const routeChatId = threadId ?? startChat?.threadId;
  const active = chats.find((chat) => chat.id === routeChatId);
  const selectChat = useCallback(
    (id: string) => {
      setMobileSidebarOpen(false);
      navigate(chatPath(id));
    },
    [navigate, setMobileSidebarOpen],
  );
  const activeThreadId = useRef<string | undefined>(active?.id);
  activeThreadId.current = active?.id;
  const computerState = useComputerState({ rpc });
  const { computer, computerOpen, setComputerOpen, booting, commitComputer } = computerState;
  useReportedUiLocale(rpc, bootstrapMe?.locale);
  const dialogs = useShellDialogs();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const findInputRef = useRef<HTMLInputElement>(null);
  const chatColumnRef = useRef<HTMLDivElement>(null);
  // Matches belong to the chat they were found in.
  useEffect(() => setFindOpen(false), [threadId]);
  useShellShortcuts({
    run: (shortcut) => {
      switch (shortcut.type) {
        case "command-menu":
          dialogs.setCommandPaletteOpen((open) => !open);
          return true;
        case "new":
        case "new-group":
          setNewChatOpen(true);
          return true;
        case "shortcuts":
          setShortcutsOpen((open) => !open);
          return true;
        case "back":
        case "forward":
          void navigate(shortcut.type === "back" ? -1 : 1);
          return true;
      }
      // The full-screen computer covers the sidebar and takes the keyboard.
      if (computerOpen) return false;
      if (shortcut.type === "toggle-sidebar") {
        if (isMobileSidebar) setMobileSidebarOpen((open) => !open);
        else setSidebarCollapsedPref(!sidebarCollapsed);
        return true;
      }
      if (shortcut.type === "search") {
        if (isMobileSidebar) setMobileSidebarOpen(true);
        else if (sidebarCollapsed) setSidebarCollapsedPref(false);
        search.setSearchOpen(true);
        focusSidebarSearch();
        return true;
      }
      // The command menu picks its own Cmd/Ctrl+1–9 from what it lists.
      if (hasOpenDialog(document, true)) return false;
      switch (shortcut.type) {
        case "integrations":
          setOverlay({ kind: "integrations" });
          return true;
        case "chat-panel":
          return toggleChatPanel();
        case "focus-composer":
          return focusComposer();
        case "find":
          if (!active) return false;
          // On a narrow window the drawer makes the chat inert and a side panel covers it, so
          // either would hide the bar.
          if (isMobileSidebar && panel) setPanel(null);
          setMobileSidebarOpen(false);
          setFindOpen(true);
          // A bar already open may have lost focus; a new one focuses itself as it mounts.
          requestAnimationFrame(() => {
            findInputRef.current?.focus();
            findInputRef.current?.select();
          });
          return true;
      }
      const nextId =
        shortcut.type === "bot"
          ? chats[shortcut.index]?.id
          : cycleBotId(chats, active?.id, shortcut.type === "next-bot" ? 1 : -1);
      if (!nextId) return false;
      selectChat(nextId);
      return true;
    },
    onTyping: () => {
      if (computerOpen || hasOpenDialog(document, true)) return;
      focusComposer();
    },
  });
  function focusComposer() {
    const composer = document.querySelector<HTMLTextAreaElement>(
      'textarea[name="chat-message"]:not(:disabled)',
    );
    composer?.focus();
    return Boolean(composer);
  }
  function toggleChatPanel() {
    if (chatPanelOpen) setPanel(null);
    else if (active) setPanel(lastChatTab.current);
    else return false;
    return true;
  }
  const openSpaceChatRef = useRef<(spaceId: string, path: string) => void>(() => {});
  useSpaceBootstrap({
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
    openSpaceChat: openSpaceChatRef,
  });
  useBrowserNotifications({
    rpc,
    activeThreadId,
    openChat: (alert) => openSpaceChatRef.current(alert.spaceId, chatPath(alert.threadId)),
    onDoodleChanged: () => {
      void refreshDoodle().catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: queries.doodle.get.queryKey() });
    },
  });
  const read = useChatRead({ rpc, threadId: active?.id, setChats });
  const {
    refreshThread,
    refreshThreadRef,
    refreshActiveThread,
    loadOlder,
    loadingOlder,
    terminalRunReceipts,
  } = useThreadSync({
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
    markReadIfVisible: read.markReadIfVisible,
  });
  const {
    editorProps: routineEditorProps,
    deleteDialogProps: deleteRoutineDialogProps,
    editingRoutine,
    restoreRoutine,
    editRoutine,
    startRoutine,
    resetRoutineTarget,
    leaveRoutine,
    addSkillRoutine,
  } = useRoutineEditor({
    rpc,
    threadId: active?.id,
    activeThreadId,
    timezone: bootstrapMe?.timezone,
    refreshThread,
    setPanel,
  });
  // Until this visit's read lands, a chat shows the routines it had last time.
  const activeRoutines = !active
    ? []
    : thread.routinesThreadId === active.id
      ? thread.routines
      : (queryClient.getQueryData(
          queries.routines.list.queryKey({ input: { threadId: active.id } }),
        ) ?? []);
  const taughtSkills = useQuery(queries.skills.list.queryOptions()).data;
  const recordingSkill = taughtSkills?.find((skill) => skill.status === "recording") ?? null;

  // The Dock badge counts unread chats in this workspace; the search box never hides one.
  const unreadChatCount = useMemo(() => chats.filter((chat) => chat.unread).length, [chats]);
  useDesktopBadge(userId ? unreadChatCount : 0);
  const openSpaceChat = useOpenSpaceChat({
    bootstrapSpaceId: bootstrapMe?.spaceId,
    userId,
    navigate,
    navigationRevision,
    overlayRevision,
    closeMobileSidebar: () => setMobileSidebarOpen(false),
  });
  useLayoutEffect(() => {
    openSpaceChatRef.current = openSpaceChat;
  }, [openSpaceChat]);

  const activeSnapshot = snapshot?.threadId === active?.id ? snapshot : null;
  const currentRuns = activeThreadRuns(activeSnapshot);
  // Everyone in the chat sees a question; only the person whose run asked it answers.
  const answerableAskIds = useMemo(() => {
    const ids = answerableAskMessageIds(activeSnapshot);
    const askerRuns = new Set(
      activeThreadRuns(activeSnapshot)
        .filter((run) => run.userId === userId)
        .map((run) => run.id),
    );
    for (const message of activeSnapshot?.messages ?? []) {
      if (ids.has(message.id) && !(message.runId && askerRuns.has(message.runId))) {
        ids.delete(message.id);
      }
    }
    return ids;
  }, [activeSnapshot, userId]);
  const dismissableAskIds = useMemo(
    () => dismissableAskMessageIds(activeSnapshot, userId),
    [activeSnapshot, userId],
  );
  const workingRuns = currentRuns.filter((run) => isRunWorking(run.status));
  const transcriptRunning = workingRuns.length > 0;
  const composerRunning = currentRuns.some((run) => isActive(run.status));
  const transcriptMessages = useMemo(
    () => activeSnapshot?.messages ?? [],
    [activeSnapshot?.messages],
  );
  const transcriptArtifactTarget = useMemo<ArtifactTarget>(
    () => ({ threadId: active?.id ?? "" }),
    [active?.id],
  );
  const { composerMentionTargets, footerLogos, setFooterLogos } = useComposerMentions({
    rpc,
    queries,
    chat: active,
    userId,
    integrationsOpen: overlay?.kind === "integrations",
    ready: initialChatsLoaded,
  });
  const shellReady =
    initialChatsLoaded && (chats.length === 0 || !active || Boolean(activeSnapshot));

  useLayoutEffect(() => {
    if (initialChatsLoaded) {
      markOnce("rk:renderer:bots-committed");
      markAfterPaint("rk:renderer:bots-painted");
    }
    if (active && snapshot?.threadId === active.id) {
      markOnce("rk:renderer:thread-committed");
      markAfterPaint("rk:renderer:thread-painted");
    }
    if (shellReady) {
      markShellReady();
      markOnce("rk:renderer:shell-ready");
      markAfterPaint("rk:renderer:shell-painted");
    }
  }, [active, initialChatsLoaded, shellReady, snapshot?.threadId]);

  const { scrollRequest, clearScrollRequest, jumpToReplyMessage } = useMessageJump({
    rpc,
    queries,
    thread,
    commitComputer,
    threadId: active?.id,
    activeThreadId,
    searchParams,
    setSearchParams,
    setPanel,
    setPanelState: rightPanel.setPanelState,
    editRoutine,
    resetRoutineTarget,
  });
  const computerControls = useComputerControls({
    rpc,
    state: computerState,
    activeId: active?.id,
    runStatus: snapshot?.run?.status,
    sandboxProvider: bootstrapMe?.sandboxProvider,
  });
  const { openComputer } = computerControls;
  const composer = useComposerActions({
    rpc,
    pageSession: pages.session,
    activeId: active?.id,
    activeThreadId,
    doodleId: doodle?.id,
    userId,
    bootstrapMe,
    activeSnapshot,
    refreshChats,
    refreshThreadRef,
    updateSnapshot: thread.updateSnapshot,
    terminalRunReceipts,
    clearReadBoundary: read.clearReadBoundary,
  });
  const { sending, sendError, stopRun } = composer;
  const { speakingMessageId, speakMessage } = useReadAloud({
    threadId: active?.id,
    snapshot: activeSnapshot,
    enabled: readAloud === true,
    voiceId: doodle?.voiceId,
  });

  const replyTargetName = composer.replyTarget
    ? composer.replyTarget.role === "user"
      ? (otherAuthor(composer.replyTarget.author, userId)?.name ?? t`You`)
      : DOODLE_NAME
    : undefined;
  useRightPanelRestore({
    rightPanel,
    userId,
    spaceId: bootstrapMe?.spaceId,
    threadId: active?.id,
    routines: thread.routines,
    routinesThreadId: thread.routinesThreadId,
    searchParams,
    editingRoutineId: editingRoutine?.id,
    restoreRoutine,
    leaveRoutine,
  });

  const replyToMessage = useCallback(
    (message: ThreadMessage) => {
      composer.setReplyTarget(message);
      composer.setReplyQuote(null);
    },
    [composer.setReplyQuote, composer.setReplyTarget],
  );
  const quoteMessage = useCallback(
    (message: ThreadMessage, quote: string) => {
      composer.setReplyTarget(message);
      composer.setReplyQuote(quote);
    },
    [composer.setReplyQuote, composer.setReplyTarget],
  );
  const markMessageUnread = useCallback(
    (message: ThreadMessage) => {
      if (active?.id) void read.markUnread(active.id, message.id).catch(() => undefined);
    },
    [active?.id, read.markUnread],
  );
  const stopTeaching = useCallback(async () => {
    if (!recordingSkill || teachBusy) return;
    setTeachBusy(true);
    try {
      await rpc.skills.stop({ skillId: recordingSkill.id });
      await queryClient.invalidateQueries({ queryKey: queries.skills.list.queryKey() });
      const id = activeThreadId.current;
      if (id) await refreshThreadRef.current(id);
      setComputerOpen(false);
    } finally {
      setTeachBusy(false);
    }
  }, [teachBusy, recordingSkill]);
  // Teach chrome needs skills applied before this resolves.
  const refreshActiveTeaching = useCallback(async () => {
    const id = activeThreadId.current;
    if (id) await refreshThreadRef.current(id);
    await queryClient.refetchQueries({ queryKey: queries.skills.list.queryKey() });
  }, []);

  function setSidebarCollapsedPref(collapsed: boolean) {
    setSidebarCollapsed(collapsed);
    writeBotsSidebarCollapsed(userId, collapsed);
  }

  function openSettings(section: SettingsSection = "general", spaceId: string | null = null) {
    setOverlay({ kind: "settings", section, spaceId });
  }

  async function createChat(input: { name?: string; userIds: string[]; doodle: boolean }) {
    const chat = await rpc.threads.create(input);
    applyChat(chat);
    selectChat(chat.id);
    return chat;
  }

  function leftChat(chat: Chat) {
    removeChat(chat.id);
    composer.discardThreadAttachments(chat.id);
    if (active?.id === chat.id) {
      setPanel(null);
      navigate(firstThreadRoute(chats.filter((item) => item.id !== chat.id)), { replace: true });
    }
    void refreshChats().catch(() => undefined);
  }

  function toggleUnread(chat: Chat) {
    const request = chat.unread ? read.markRead(chat.id) : read.markUnread(chat.id);
    void request.catch(() => undefined);
  }

  function openWorkspace(workspace: Workspace) {
    if (workspace.id === currentSpaceId) return;
    openSpaceChat(workspace.id, "/app");
  }

  const settingsNavItems = useSettingsNavItems({
    wallet: Boolean(bootstrapMe?.paymentWalletProvider),
    computer: true,
    billing: bootstrapMe?.billingEnabled === true,
    updates: Boolean(desktopBridge()?.update),
  });
  const paletteActions: CommandPaletteAction[] = [
    {
      id: "new-chat",
      label: t`New chat`,
      icon: SquarePen,
      onSelect: () => setNewChatOpen(true),
    },
    {
      id: "integrations",
      label: t`Connect apps`,
      icon: Plug,
      onSelect: () => setOverlay({ kind: "integrations" }),
    },
    {
      id: "keyboard-shortcuts",
      label: t`Keyboard shortcuts`,
      icon: Keyboard,
      onSelect: () => setShortcutsOpen(true),
    },
    {
      id: "skills",
      label: t`Skills`,
      icon: ScrollText,
      onSelect: () => setOverlay({ kind: "skills" }),
    },
    ...settingsNavItems.map(({ id, label, icon }) => ({
      id: `settings-${id}`,
      label: t`Settings: ${label}`,
      icon,
      onSelect: () => openSettings(id),
    })),
    ...(
      [
        { value: "system", label: t`System`, icon: Monitor },
        { value: "light", label: t`Light`, icon: Sun },
        { value: "dark", label: t`Dark`, icon: Moon },
      ] satisfies { value: AppearancePreference; label: string; icon: typeof Sun }[]
    ).map(({ value, label, icon }) => ({
      id: `appearance-${value}`,
      label: t`Appearance: ${label}`,
      icon,
      checked: getUiAppearancePreference() === value,
      onSelect: () => setUiAppearance(value),
    })),
  ];

  async function renameSpace(spaceId: string, name: string) {
    await rpc.spaces.rename({ spaceId, name });
    roster.setWorkspaces((current) =>
      current.map((workspace) => (workspace.id === spaceId ? { ...workspace, name } : workspace)),
    );
    await refreshChats().catch(() => undefined);
  }

  async function leftSpace(spaceId: string, activeSpaceId: string) {
    const effectiveSpaceId = selectedSpaceId() ?? bootstrapMe?.spaceId;
    // Leaving the open workspace changes the auth boundary, so reload like a switch.
    if (effectiveSpaceId === spaceId && selectSpace(activeSpaceId)) {
      window.location.assign("/app");
      return;
    }
    await refreshChats();
  }

  const shell = (
    <BotsSidebarLayout
      userId={userId}
      collapsed={sidebarCollapsed}
      onCollapsedChange={setSidebarCollapsedPref}
      onPreviewCollapsedChange={setSidebarCollapsed}
      computerOpen={computerOpen}
      data-testid="shell-root"
      data-ready={shellReady}
      className="relative flex h-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground/90 [&[data-resizing-sidebar]_*[data-slot=sidebar-gap]]:transition-none [&[data-resizing-sidebar]_*[data-slot=sidebar-container]]:transition-none"
      {...swipeHandlers}
    >
      <ComputerUpdateProgress
        onCompleted={() => {
          if (active) void refreshThread(active.id);
        }}
      />
      {bootstrapMe !== undefined ? (
        <HostComputerPrompt initialMe={bootstrapMe ?? undefined} onMeUpdated={setBootstrapMe} />
      ) : null}
      <ShellSidebar
        isMobile={isMobileSidebar}
        mobileOpen={mobileSidebarOpen}
        setMobileOpen={setMobileSidebarOpen}
        density={sidebarDensity}
        collapsed={sidebarCollapsed}
        mini={miniSidebar}
        setCollapsedPref={setSidebarCollapsedPref}
        onNewChat={() => {
          setMobileSidebarOpen(false);
          setNewChatOpen(true);
        }}
        search={search}
        switcher={
          <WorkspaceSwitcher
            workspaces={workspaces}
            currentId={currentSpaceId ?? undefined}
            onSelect={openWorkspace}
            onInvite={() => openSettings("space")}
            onSettings={() => openSettings("space")}
          />
        }
        chatList={
          <ChatList
            chats={chats}
            activeId={active?.id}
            userId={userId}
            density={sidebarDensity}
            mini={miniSidebar}
            onOpen={(chat) => selectChat(chat.id)}
            onToggleUnread={toggleUnread}
            onLeave={(chat) => dialogs.setLeaveTarget(chat)}
          />
        }
        footerLogos={footerLogos}
        user={session.data?.user}
        navLinks={desktopBridge() ? [] : (bootstrapMe?.navLinks ?? [])}
        navigate={navigate}
        openSettings={openSettings}
        openIntegrations={() => setOverlay({ kind: "integrations" })}
        openSkills={() => setOverlay({ kind: "skills" })}
      />

      {/* Keep the composer's z-index inside the chat so phone overlays like the side panel cover it. */}
      <main
        data-space-switch="main"
        aria-hidden={mobileSidebarOpen || undefined}
        inert={mobileSidebarOpen}
        className="isolate flex min-w-0 flex-1 flex-col bg-background"
      >
        {/* Inside main so the composer and its menus stay above it. */}
        {!mobileSidebarOpen ? (
          <div
            data-testid="mobile-sidebar-swipe-edge"
            aria-hidden="true"
            className="absolute bottom-20 start-0 top-16 z-20 w-8 touch-none md:hidden"
          />
        ) : null}
        {/* The header floats so the transcript scrolls under its buttons. */}
        <div ref={chatColumnRef} className="relative flex min-h-0 flex-1 flex-col">
          {/* Only the pills take input; the gaps pass clicks and scrolling to the transcript. */}
          <div aria-hidden="true" className="app-drag absolute inset-x-0 top-0 z-10 h-3" />
          {findOpen ? (
            <div className="absolute end-3 top-14 z-20">
              <ChatFindBar
                scope={chatColumnRef}
                inputRef={findInputRef}
                onClose={() => {
                  setFindOpen(false);
                  focusComposer();
                }}
              />
            </div>
          ) : null}
          <ChatHeader
            chat={active}
            panelOpen={chatPanelOpen}
            onOpenNavigation={() => setMobileSidebarOpen(true)}
            onTogglePanel={toggleChatPanel}
          />
          {!active && initialChatsLoaded ? (
            <div className="flex-1" />
          ) : (
            <Transcript
              key={activeSnapshot?.threadId}
              meId={userId}
              scrollRef={thread.messageScroll}
              scrollRequest={scrollRequest}
              onScrollRequestHandled={clearScrollRequest}
              followRequest={composer.sentCount}
              artifactTarget={transcriptArtifactTarget}
              markedUnreadMessageId={read.markedUnreadMessageId}
              messages={transcriptMessages}
              showToolActivity={showToolActivity}
              olderCursor={activeSnapshot?.olderCursor ?? null}
              unreadAfterSeq={read.unreadAfterSeq}
              loadingOlder={loadingOlder}
              answerableAskIds={answerableAskIds}
              dismissableAskIds={dismissableAskIds}
              running={transcriptRunning}
              members={active?.members ?? []}
              showSpeakers={Boolean(active && !soloChat(active, userId))}
              onLoadOlder={loadOlder}
              onAnswer={composer.answerMessage}
              onReply={replyToMessage}
              onMarkUnread={markMessageUnread}
              onQuote={quoteMessage}
              onReact={composer.reactToMessage}
              onJumpToMessage={jumpToReplyMessage}
              onRefresh={refreshActiveThread}
              onBotChanged={refreshActiveThread}
              onAddRoutine={addSkillRoutine}
              voiceReady={Boolean(voiceStatus?.ready)}
              speakingMessageId={speakingMessageId}
              onSpeak={speakMessage}
              onOpenComputer={computerControls.onOpenComputer}
              rpc={rpc}
            />
          )}
        </div>
        {active ? (
          // Let messages continue behind the composer's rounded top corners.
          <div className="pointer-events-none relative z-30 -mt-7">
            {recordingSkill ? (
              <div className="pointer-events-auto bg-background px-6 pb-2 text-center text-[13px] text-destructive">
                <Trans>Teaching in progress. Stop teaching before sending a new message.</Trans>
              </div>
            ) : null}
            <Composer
              key={active.id}
              draftKey={`chat:${active.id}`}
              enterToSend={enterToSend}
              activeName={
                soloChat(active, userId)
                  ? active.doodle
                    ? DOODLE_NAME
                    : undefined
                  : active.title || undefined
              }
              running={composerRunning}
              disabled={Boolean(recordingSkill)}
              pendingAttachments={composer.activePendingAttachments}
              attachmentNotice={composer.attachmentNotice}
              sendError={sendError}
              imageConfirmation={composer.imageConfirmation}
              onDraftEdited={composer.clearImageConfirmation}
              onOpenModels={() => openSettings("models")}
              onOpenConnections={() => openSettings("models")}
              runError={composer.displayedRunError}
              runErrorId={composer.displayedRunErrorId}
              onRunErrorPresented={composer.handleRunErrorPresented}
              onDismissError={composer.dismissComposerError}
              sending={sending}
              fileInputRef={composer.fileInputRef}
              onAttachmentPick={composer.onAttachmentPick}
              onRemoveAttachment={composer.removeAttachment}
              onSend={composer.sendMessage}
              onStop={stopRun}
              dictationTranscribe={voiceStatus ? Boolean(voiceStatus.transcribe) : undefined}
              artifactTarget={transcriptArtifactTarget}
              replyTarget={composer.replyTarget}
              replyQuote={composer.replyQuote}
              replyTargetName={replyTargetName}
              onClearReply={composer.clearReply}
              mentionTargets={composerMentionTargets}
              agentSkills={agentSkills}
              onSlashOpen={refreshAgentSkills}
              onSlashAction={(action) => {
                if (action === "chat-settings") {
                  setPanel(lastChatTab.current);
                  return;
                }
                if (action === "settings-general") {
                  openSettings("general");
                  return;
                }
                if (action === "settings-usage") {
                  openSettings("usage");
                }
              }}
            />
          </div>
        ) : null}
      </main>

      <PageViewHost />

      <ShellSidePanel
        panel={panel}
        setPanel={setPanel}
        chat={active}
        userId={userId}
        members={workspaceMembers}
        routinesPanel={
          <RoutineList
            routines={activeRoutines}
            runningRoutineId={
              snapshot?.run && isActive(snapshot.run.status)
                ? (snapshot.run.routineId ?? undefined)
                : undefined
            }
            onCreate={() => startRoutine()}
            onEdit={startRoutine}
            onStop={() => void stopRun()}
          />
        }
        routineEditorProps={routineEditorProps}
        onSetDoodle={async (on) => {
          if (!active) return;
          applyChat(await rpc.threads.setDoodle({ threadId: active.id, doodle: on }));
          void refreshThread(active.id).catch(() => undefined);
        }}
        onAddPeople={async (userIds) => {
          if (!active) return;
          applyChat(await rpc.threads.addMembers({ threadId: active.id, userIds }));
        }}
        onRename={async (name) => {
          if (!active) return;
          applyChat(await rpc.threads.rename({ threadId: active.id, name }));
        }}
        onLeave={() => {
          if (active) dialogs.setLeaveTarget(active);
        }}
        onClear={() => {
          if (active) dialogs.setClearTarget(active);
        }}
      />

      <NewChatDialog
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        members={workspaceMembers}
        userId={userId}
        onCreate={createChat}
      />

      <Suspense fallback={null}>
        <ShellDialogs
          dialogs={dialogs}
          rpc={rpc}
          chats={chats}
          userId={userId}
          activeId={active?.id}
          navigate={navigate}
          onLeft={leftChat}
          closeMobileSidebar={() => setMobileSidebarOpen(false)}
          refreshChats={refreshChats}
          clearOpenThread={() => {
            thread.resetHistory();
            thread.updateSnapshot((current) =>
              current ? { ...current, messages: [], olderCursor: null, run: null } : current,
            );
          }}
          deleteRoutineDialogProps={deleteRoutineDialogProps}
          paletteActions={paletteActions}
        />
        <AppOverlays
          overlay={overlay}
          setOverlay={setOverlay}
          activeThreadId={active?.id}
          stdioEnabled={bootstrapMe?.mcpStdioEnabled === true}
          onConnectedAppsChange={setFooterLogos}
        />
      </Suspense>

      <Suspense fallback={null}>
        <SettingsOverlays
          rpc={rpc}
          queries={queries}
          overlay={overlay}
          setOverlay={setOverlay}
          settingsSpace={settingsSpace}
          showSettings={settingsSpaceId === null || Boolean(settingsSpace)}
          renameSpace={renameSpace}
          leftSpace={leftSpace}
          onOpenComputer={() => void openComputer()}
          user={session.data?.user}
          refetchSession={() => session.refetch({ query: { disableCookieCache: true } })}
          bootstrapMe={bootstrapMe}
          setBootstrapMe={setBootstrapMe}
          memoryConfig={memoryProviderConfig}
        />
      </Suspense>

      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        host={{ desktop: Boolean(desktopBridge()), apple: isApplePlatform() }}
      />

      {computerOpen ? (
        <ComputerOverlay
          computer={computer}
          computerViewport={computerState.computerViewport}
          recordingSkill={recordingSkill}
          teachBusy={teachBusy}
          hasControl={computerControls.hasControl}
          composerRunning={composerRunning}
          sending={sending}
          booting={booting}
          runStatus={snapshot?.run?.status}
          sendError={sendError}
          embeddedScreenUrl={computerControls.embeddedScreenUrl}
          screenFrameKey={computerState.screenFrameKey}
          screenFrameRef={computerState.setScreenFrame}
          computerScreenError={computerControls.computerScreenError}
          computerBooting={computerControls.computerBooting}
          onStopTeaching={stopTeaching}
          onStopRun={() => void stopRun()}
          onRelease={computerControls.releaseComputer}
          onTakeControl={() => void openComputer(true)}
          onStart={() => void openComputer()}
          onRefreshTeaching={refreshActiveTeaching}
          onRefreshComputer={computerControls.refreshComputer}
          onClose={() => setComputerOpen(false)}
        />
      ) : null}
    </BotsSidebarLayout>
  );

  // Empty chrome until the first list lands would flash an empty workspace before the chat.
  return initialChatsLoaded || initialLoadFailed ? (
    <PagesProvider value={pages}>{shell}</PagesProvider>
  ) : (
    <PageLoading />
  );
}
