import type { Bot, BotSection, Group, NavLink, Space } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fn, userEvent, within } from "storybook/test";
import type { BotsSidebarDensity } from "../../lib/bots-sidebar-density-pref";
import type { Panel } from "../../lib/right-panel-state";
import { rpc } from "../../lib/rpc";
import { api } from "../../storybook/api";
import { CHIEF, GROUP, ME, NOW, SCOUT, SESSION, SPACE, USER_ID } from "../../storybook/fixtures";
import type { SettingsSection } from "../shell-overlay";
import { ArchivedChats } from "./archived-chats";
import { ShellSidebar } from "./shell-sidebar";
import { BotsSidebarLayout } from "./sidebar-layout";
import { SidebarRoster } from "./sidebar-roster";
import { rosterData } from "./sidebar-roster.stories";
import { sidebarGroupsForSpaces } from "./space-sidebar";
import { useSidebarSearch } from "./use-sidebar-search";

type SidebarStoryProps = {
  bots: Bot[];
  groups: Group[];
  botSections: BotSection[];
  otherSpaces: Space[];
  archivedBots: Bot[];
  archivedGroups: Group[];
  density: BotsSidebarDensity;
  collapsed: boolean;
  activeId: string;
  ticketBoardEnabled: boolean;
  navLinks: NavLink[];
  navigate: (path: string) => void;
  setPanel: (panel: Panel) => void;
  openSettings: (section: SettingsSection) => void;
  openIntegrations: () => void;
  openSkills: () => void;
  openSpaceChat: (spaceId: string, path: string) => void;
  setNewSpaceOpen: (open: boolean) => void;
  setCreateBotOpen: (open: boolean) => void;
};

function SidebarStory({
  bots,
  groups,
  botSections,
  otherSpaces,
  archivedBots,
  archivedGroups,
  density,
  collapsed: initialCollapsed,
  activeId,
  ...callbacks
}: SidebarStoryProps) {
  const routerNavigate = useNavigate();
  const search = useSidebarSearch({ rpc, navigate: routerNavigate });
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  useEffect(() => setCollapsed(initialCollapsed), [initialCollapsed]);
  const [collapsedSections, setCollapsedSections] = useState<ReadonlySet<string>>(new Set());
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [botMenu, setBotMenu] = useState<{ kind: "bot" | "group"; id: string } | null>(null);
  const [draggedBotId, setDraggedBotId] = useState<string | null>(null);
  const [rosterDropKey, setRosterDropKey] = useState<string | null>(null);
  const spaces = [{ ...SPACE, bots, groups, botSections }, ...otherSpaces];
  const toggleSection = (key: string) =>
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <BotsSidebarLayout
      userId={USER_ID}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      onPreviewCollapsedChange={setCollapsed}
      computerOpen={false}
      className="relative flex h-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground/90"
    >
      <ShellSidebar
        {...callbacks}
        isMobile={false}
        mobileOpen={false}
        setMobileOpen={fn()}
        density={density}
        collapsed={collapsed}
        mini={collapsed}
        setCollapsedPref={setCollapsed}
        createMenuOpen={createMenuOpen}
        setCreateMenuOpen={setCreateMenuOpen}
        search={search}
        bots={bots}
        groups={groups}
        collapsedSidebarSections={collapsedSections}
        toggleSidebarSection={toggleSection}
        footerLogos={[]}
        user={SESSION.user}
        roster={
          <SidebarRoster
            mini={collapsed}
            sidebarGroups={sidebarGroupsForSpaces(
              spaces,
              collapsed ? "" : search.query,
              rosterData.labels,
            )}
            collapsedSidebarSections={collapsedSections}
            bootstrapMe={ME}
            botSections={botSections}
            spaces={spaces}
            rosterDropKey={rosterDropKey}
            setRosterDropKey={setRosterDropKey}
            rosterDropAction={() => null}
            applyRosterDrop={fn()}
            openSpaceChat={callbacks.openSpaceChat}
            spaceMenuAnchor={{ current: null }}
            setSpaceMenu={fn()}
            setRenameSectionTarget={fn()}
            setDeleteSectionTarget={fn()}
            toggleSidebarSection={toggleSection}
            inGroup={false}
            active={{ id: activeId }}
            activeGroup={undefined}
            botsSidebarDensity={density}
            dismissedRunErrorIds={new Set()}
            displayedRunError={null}
            draggedBotId={draggedBotId}
            setDraggedBotId={setDraggedBotId}
            botMenu={botMenu}
            setBotMenu={setBotMenu}
            reorderRosterBot={fn()}
            activeSnapshot={null}
            botMenuContent={null}
          />
        }
        archived={
          <ArchivedChats
            archivedBots={archivedBots}
            archivedGroups={archivedGroups}
            showSpaceSearch={search.showSpaceSearch}
            rpc={rpc}
            refreshBots={async () => undefined}
            setDeleteTarget={fn()}
            setDeleteGroupTarget={fn()}
          />
        }
      />
      <main className="isolate flex min-w-0 flex-1 flex-col bg-background" />
    </BotsSidebarLayout>
  );
}

const meta = {
  title: "Shell/Sidebar",
  component: SidebarStory,
  decorators: [
    (Story) => (
      <div style={{ height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    api: api({
      runs: { list: { runs: [] } },
      bots: { restore: { ok: true } },
      groups: { restore: { ok: true } },
      search: {
        query: {
          hits: [
            {
              kind: "message",
              botId: SCOUT.id,
              botName: SCOUT.name,
              title: SCOUT.name,
              snippet: "The launch post is drafted and waiting for review.",
              messageId: "message-search-1",
              seq: 4,
            },
            {
              kind: "conversation",
              groupId: GROUP.id,
              groupName: GROUP.name,
              title: GROUP.name,
              snippet: "Scout: the launch post is drafted.",
            },
          ],
        },
      },
    }),
  },
  args: {
    bots: rosterData.bots,
    groups: rosterData.groups,
    botSections: rosterData.sections,
    otherSpaces: [],
    archivedBots: [],
    archivedGroups: [],
    density: "comfortable",
    collapsed: false,
    activeId: CHIEF.id,
    ticketBoardEnabled: false,
    navLinks: [],
    navigate: fn(),
    setPanel: fn(),
    openSettings: fn(),
    openIntegrations: fn(),
    openSkills: fn(),
    openSpaceChat: fn(),
    setNewSpaceOpen: fn(),
    setCreateBotOpen: fn(),
  },
  argTypes: {
    density: { control: "inline-radio", options: ["comfortable", "compact"] },
  },
} satisfies Meta<typeof SidebarStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sections: Story = {};

export const Archived: Story = {
  args: {
    archivedBots: [
      { ...SCOUT, id: "bot-archived-1", name: "Courier", unread: false, archivedAt: NOW },
      { ...CHIEF, id: "bot-archived-2", name: "Tally", pinned: false, archivedAt: NOW },
    ],
    archivedGroups: [{ ...GROUP, id: "group-archived-1", name: "Spring launch", archivedAt: NOW }],
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Archived/ }));
  },
};

export const LongRoster: Story = {
  args: { bots: rosterData.longBots, botSections: [], activeId: "bot-long-4" },
};

export const Spaces: Story = { args: { otherSpaces: rosterData.otherSpaces } };

export const Collapsed: Story = { args: { collapsed: true } };

export const Searching: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId("sidebar-search-trigger"));
    await userEvent.type(canvas.getByRole("textbox", { name: "Search" }), "launch");
  },
};
