import type { Bot, BotSection, Group, Space } from "@labradoodle/contracts";
import { BOT_COLOR_LIST } from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { bot, CHIEF, GROUP, LEDGER, ME, NOW, SCOUT, SPACE } from "../../storybook/fixtures";
import { SidebarRoster } from "./sidebar-roster";
import { sidebarGroupsForSpaces } from "./space-sidebar";

const color = (index: number) => BOT_COLOR_LIST[index % BOT_COLOR_LIST.length]!.hex;
const daysAgo = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

const sections: BotSection[] = [
  { id: "section-research", name: "Research", position: 0, createdAt: NOW, updatedAt: NOW },
  { id: "section-ops", name: "Operations", position: 1, createdAt: NOW, updatedAt: NOW },
];

const sectionBots: Bot[] = [
  CHIEF,
  { ...SCOUT, sectionId: "section-research" },
  bot({
    id: "bot-4",
    name: "Quill",
    color: color(3),
    sectionId: "section-research",
    preview: "Draft two is ready for your notes.",
    updatedAt: daysAgo(1),
  }),
  { ...LEDGER, sectionId: "section-ops" },
  bot({
    id: "bot-5",
    name: "Harbor",
    color: color(4),
    sectionId: "section-ops",
    preview: "Which region should the backups go to?",
    status: "waiting_input",
    updatedAt: daysAgo(3),
  }),
  bot({
    id: "bot-6",
    name: "Sentry",
    color: color(5),
    preview: "The nightly check did not finish.",
    runErrorId: "run-error-1",
    updatedAt: daysAgo(12),
  }),
];

const sectionGroups: Group[] = [{ ...GROUP, unread: true }];

const names = [
  "Atlas",
  "Beacon",
  "Courier",
  "Delta",
  "Ember",
  "Fable",
  "Garnet",
  "Juniper",
  "Kestrel",
  "Lumen",
  "Mosaic",
  "Nimbus",
  "Orbit",
  "Pilot",
  "Ripple",
  "Tally",
  "Umber",
  "Vesper",
  "Willow",
  "Zephyr",
];

const longBots: Bot[] = [
  bot({
    id: "bot-long-name",
    name: "Quarterly planning and budget review assistant",
    color: color(6),
    preview:
      "I compared every line of the budget against last quarter and flagged the three that moved most.",
  }),
  ...names.map((name, index) =>
    bot({
      id: `bot-long-${index}`,
      name,
      color: color(index),
      pinned: index < 2,
      unread: index % 5 === 0,
      status: index === 3 ? "running" : index === 7 ? "queued" : "idle",
      preview: `Finished the ${name.toLowerCase()} checklist and filed the notes.`,
      updatedAt: daysAgo(index % 9),
    }),
  ),
];

const otherSpaces: Space[] = [
  {
    ...SPACE,
    id: "space-2",
    name: "Design studio",
    isDefault: false,
    canRename: true,
    canDelete: true,
    bots: [
      bot({
        id: "bot-design-1",
        spaceId: "space-2",
        name: "Palette",
        color: color(7),
        preview: "Three logo directions are up.",
        unread: true,
      }),
      bot({
        id: "bot-design-2",
        spaceId: "space-2",
        name: "Grid",
        color: color(8),
        preview: "Spacing tokens are consistent now.",
      }),
    ],
    groups: [],
    botSections: [],
  },
  {
    ...SPACE,
    id: "space-3",
    name: "Side project",
    isDefault: false,
    canRename: true,
    canDelete: true,
    bots: [],
    groups: [],
    botSections: [],
  },
];

export const rosterData = {
  sections,
  bots: sectionBots,
  groups: sectionGroups,
  longBots,
  otherSpaces,
  labels: { pinned: "Pinned", unassigned: "Unassigned" },
};

function roster(bots: Bot[], groups: Group[], botSections: BotSection[], others: Space[] = []) {
  const spaces = [{ ...SPACE, bots, groups, botSections }, ...others];
  return {
    spaces,
    botSections,
    sidebarGroups: sidebarGroupsForSpaces(spaces, "", rosterData.labels),
  };
}

const meta = {
  title: "Shell/Sidebar roster",
  component: SidebarRoster,
  excludeStories: /.*Data$/,
  parameters: { layout: "padded" },
  decorators: [
    (Story, { args }) => (
      <div
        className="flex flex-col gap-0.5 rounded-xl bg-sidebar px-2.5 py-2.5"
        style={{ width: args.mini ? 72 : 300 }}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    ...roster(sectionBots, sectionGroups, sections),
    collapsedSidebarSections: new Set<string>(),
    bootstrapMe: ME,
    rosterDropKey: null,
    setRosterDropKey: fn(),
    rosterDropAction: fn(),
    applyRosterDrop: fn(),
    openSpaceChat: fn(),
    spaceMenuAnchor: { current: null },
    setSpaceMenu: fn(),
    setRenameSectionTarget: fn(),
    setDeleteSectionTarget: fn(),
    toggleSidebarSection: fn(),
    inGroup: false,
    active: CHIEF,
    activeGroup: undefined,
    botsSidebarDensity: "comfortable",
    dismissedRunErrorIds: new Set<string>(),
    displayedRunError: null,
    draggedBotId: null,
    setDraggedBotId: fn(),
    botMenu: null,
    setBotMenu: fn(),
    reorderRosterBot: fn(),
    activeSnapshot: null,
    botMenuContent: null,
  },
} satisfies Meta<typeof SidebarRoster>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sections: Story = {};

export const Compact: Story = { args: { botsSidebarDensity: "compact" } };

export const CollapsedSection: Story = {
  args: { collapsedSidebarSections: new Set(["section:section-research"]) },
};

export const Mini: Story = { args: { mini: true } };

export const MultipleSpaces: Story = {
  args: roster(sectionBots.slice(0, 3), [GROUP], [], otherSpaces),
};

export const LongRoster: Story = {
  args: { ...roster(longBots, [GROUP], []), active: { id: "bot-long-4" } },
};
