import type { NavLink } from "@labradoodle/contracts";
import { accountDisplay } from "@labradoodle/core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Sidebar,
} from "@labradoodle/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { PasskeyOffer } from "../../components/PasskeyOffer";
import { SidebarFooter } from "../../components/SidebarFooter";
import type { BotsSidebarDensity } from "../../lib/bots-sidebar-density-pref";
import { clearComposerDrafts } from "../../lib/composer-draft";
import { clearSpaceSelection } from "../../lib/rpc";
import { useSignOut } from "../../lib/sign-out";
import { SpaceSearchResults } from "../SpaceSearch";
import type { SettingsSection } from "../shell-overlay";
import { SidebarHeader } from "./sidebar-header";
import type { SidebarSearch } from "./use-sidebar-search";

/** Focuses the search box once it renders, its text selected so typing replaces it. */
export function focusSidebarSearch() {
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>('input[name="sidebar-search"]');
    input?.focus();
    input?.select();
  });
}

type User = { name?: string | null; email?: string; image?: string | null };

/** The chats sidebar: a drawer on phones, collapsible to icons elsewhere. */
export function ShellSidebar({
  isMobile,
  mobileOpen,
  setMobileOpen,
  density,
  collapsed,
  mini,
  setCollapsedPref,
  onNewChat,
  search,
  switcher,
  chatList,
  footerLogos,
  user,
  navLinks,
  startOver,
  navigate,
  openSettings,
  openIntegrations,
  openSkills,
}: {
  isMobile: boolean;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  density: BotsSidebarDensity;
  collapsed: boolean;
  mini: boolean;
  setCollapsedPref: (collapsed: boolean) => void;
  onNewChat: () => void;
  search: SidebarSearch;
  switcher: ReactNode;
  chatList: ReactNode;
  footerLogos: Array<{ name: string; logo?: string | null }>;
  user: User | undefined;
  navLinks: NavLink[];
  startOver: boolean;
  navigate: (path: string) => void;
  openSettings: (section: SettingsSection) => void;
  openIntegrations: () => void;
  openSkills: () => void;
}) {
  const { t } = useLingui();
  const {
    query,
    setQuery,
    searchOpen,
    setSearchOpen,
    searchHits,
    searchLoading,
    searchError,
    retrySearch,
    showSpaceSearch,
    jumpToSearchHit,
  } = search;
  return (
    <>
      <button
        type="button"
        aria-label={t`Close navigation`}
        aria-hidden={mobileOpen ? undefined : true}
        inert={mobileOpen ? undefined : true}
        tabIndex={mobileOpen ? undefined : -1}
        onClick={() => setMobileOpen(false)}
        className={`absolute inset-y-0 end-0 start-[min(calc(100%-48px),316px)] z-30 bg-overlay transition-opacity duration-250 ease-drawer motion-reduce:transition-none md:hidden ${
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <Sidebar
        collapsible={isMobile ? "none" : "icon"}
        side={document.documentElement.dir === "rtl" ? "right" : "left"}
        data-testid="bots-sidebar"
        data-space-switch="sidebar"
        inert={isMobile && !mobileOpen ? true : undefined}
        aria-hidden={isMobile && !mobileOpen ? true : undefined}
        data-bots-sidebar-density={density}
        data-collapsed={collapsed ? "true" : "false"}
        className={
          isMobile
            ? `absolute inset-y-0 start-0 z-40 flex w-[calc(100%-48px)] max-w-[316px] shrink-0 flex-col border-e border-sidebar-border bg-sidebar transition-transform duration-250 ease-drawer motion-reduce:transition-none ${mobileOpen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full"}`
            : "h-full overflow-hidden border-sidebar-border"
        }
      >
        <SidebarHeader
          mini={mini}
          searchOpen={searchOpen && !mini}
          onSearch={() => {
            if (searchOpen && !mini) {
              setQuery("");
              setSearchOpen(false);
              return;
            }
            if (mini) setCollapsedPref(false);
            setSearchOpen(true);
            focusSidebarSearch();
          }}
          workspace={switcher}
          onNewChat={onNewChat}
          setSidebarCollapsedPref={setCollapsedPref}
        />
        {mini || !(searchOpen || query) ? null : (
          <InputGroup
            data-testid="sidebar-search"
            className="mx-2.5 mb-3 w-auto rounded-xl bg-card dark:bg-input border border-border text-muted-foreground focus-within:border-ring"
          >
            <InputGroupAddon>
              <Search size={16} strokeWidth={1.8} aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key !== "Escape" ||
                  event.nativeEvent.isComposing ||
                  event.keyCode === 229
                )
                  return;
                setQuery("");
                setSearchOpen(false);
              }}
              placeholder={t`Search`}
              aria-label={t`Search`}
              autoComplete="off"
              name="sidebar-search"
            />
          </InputGroup>
        )}
        <div className="rk-scroll scroll-fade-y scroll-fade-12 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-2.5">
          {showSpaceSearch && !mini ? (
            <SpaceSearchResults
              hits={searchHits}
              loading={searchLoading}
              error={searchError}
              onRetry={retrySearch}
              onSelect={(hit) => {
                setMobileOpen(false);
                jumpToSearchHit(hit);
              }}
            />
          ) : (
            chatList
          )}
        </div>
        <div className={mini ? "hidden" : "contents"}>
          <PasskeyOffer />
        </div>
        <ShellSidebarFooter
          mini={mini}
          logos={footerLogos}
          user={user}
          navLinks={navLinks}
          startOver={startOver}
          closeMobileSidebar={() => setMobileOpen(false)}
          navigate={navigate}
          openSettings={openSettings}
          openIntegrations={openIntegrations}
          openSkills={openSkills}
        />
      </Sidebar>
    </>
  );
}

function ShellSidebarFooter({
  mini,
  logos,
  user,
  navLinks,
  startOver,
  closeMobileSidebar,
  navigate,
  openSettings,
  openIntegrations,
  openSkills,
}: {
  mini: boolean;
  logos: Array<{ name: string; logo?: string | null }>;
  user: User | undefined;
  navLinks: NavLink[];
  startOver: boolean;
  closeMobileSidebar: () => void;
  navigate: (path: string) => void;
  openSettings: (section: SettingsSection) => void;
  openIntegrations: () => void;
  openSkills: () => void;
}) {
  const { t } = useLingui();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logOutError, setLogOutError] = useState<string | null>(null);
  const { signingOut, logOut } = useSignOut("/sign-in", (message) => {
    // A failed sign-out reloads the page: reopen the menu so its error shows.
    setMenuOpen(true);
    setLogOutError(message);
  });
  const [confirmStartOver, setConfirmStartOver] = useState(false);
  const [startingOver, setStartingOver] = useState(false);
  const [startOverError, setStartOverError] = useState<string | null>(null);
  const { label: userName, initial: initials } = accountDisplay(user ?? {}, t`You`);
  const runStartOver = async () => {
    setStartingOver(true);
    setStartOverError(null);
    const response = await fetch("/api/dev/start-over", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => null);
    if (response?.ok) {
      clearSpaceSelection();
      clearComposerDrafts();
      window.location.assign("/sign-in?next=/onboarding");
      return;
    }
    setStartingOver(false);
    setStartOverError(t`Could not start over. Try again.`);
  };
  return (
    <>
      <SidebarFooter
        mini={mini}
        logos={logos}
        name={userName}
        initials={initials}
        image={user?.image}
        email={user?.email}
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (!open) setLogOutError(null);
        }}
        onIntegrations={() => {
          setMenuOpen(false);
          openIntegrations();
        }}
        onSkills={() => {
          setMenuOpen(false);
          openSkills();
        }}
        links={navLinks}
        onLink={(link) => {
          setMenuOpen(false);
          closeMobileSidebar();
          navigate(`/app/x/${link.id}`);
        }}
        onArtifacts={() => {
          setMenuOpen(false);
          closeMobileSidebar();
          navigate("/app/artifacts");
        }}
        onSettings={() => {
          setMenuOpen(false);
          openSettings("general");
        }}
        onLogOut={() => {
          setLogOutError(null);
          void logOut();
        }}
        signingOut={signingOut}
        logOutError={logOutError}
        onStartOver={
          startOver
            ? () => {
                setMenuOpen(false);
                setConfirmStartOver(true);
              }
            : undefined
        }
      />
      <AlertDialog
        open={confirmStartOver}
        onOpenChange={(open) => {
          if (startingOver) return;
          setConfirmStartOver(open);
          if (!open) setStartOverError(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Delete everything and start over?</Trans>
            </AlertDialogTitle>
          </AlertDialogHeader>
          {startOverError ? (
            <p role="alert" className="text-[13px] text-destructive">
              {startOverError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={startingOver}>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={startingOver}
              onClick={() => void runStartOver()}
            >
              {startingOver ? <Trans>Starting over…</Trans> : <Trans>Start over</Trans>}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
