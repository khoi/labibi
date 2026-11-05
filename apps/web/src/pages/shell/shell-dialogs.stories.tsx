import type { BotSection, PageSummary, Space } from "@labradoodle/contracts";
import { DEFAULT_NEW_BOT_AVATAR_SET } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plug, Users } from "lucide-react";
import type { ComponentProps } from "react";
import { useEffect, useRef } from "react";
import { fn, screen, userEvent } from "storybook/test";
import { rpc } from "../../lib/rpc";
import { api } from "../../storybook/api";
import { BOTS, CHIEF, GROUP, NOW, SPACE, SPACE_ID } from "../../storybook/fixtures";
import type { ShellDialogsState } from "./shell-dialogs";
import { ShellDialogs, useShellDialogs } from "./shell-dialogs";

const SUPPORT: Space = {
  ...SPACE,
  id: "space-2",
  name: "Customer support",
  isDefault: false,
  canDelete: true,
  botCount: 2,
  bots: [],
  groups: [],
};

const SECTION: BotSection = {
  id: "section-1",
  name: "Research",
  position: 0,
  createdAt: NOW,
  updatedAt: NOW,
};

const PAGES: PageSummary[] = [
  {
    id: "page-1",
    title: "Q3 report",
    botId: CHIEF.id,
    groupId: null,
    visibility: "private",
    currentVersion: 2,
    pinned: true,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "page-2",
    title: "Launch checklist",
    botId: null,
    groupId: GROUP.id,
    visibility: "link",
    currentVersion: 1,
    pinned: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

type HarnessProps = Omit<ComponentProps<typeof ShellDialogs>, "dialogs"> & {
  setup: (dialogs: ShellDialogsState) => void;
};

function ShellDialogsHarness({ setup, ...props }: HarnessProps) {
  const dialogs = useShellDialogs();
  const latest = useRef(dialogs);
  latest.current = dialogs;
  useEffect(() => setup(latest.current), [setup]);
  return <ShellDialogs dialogs={dialogs} {...props} />;
}

const meta = {
  title: "Shell/Shell dialogs",
  decorators: [
    (Story) => (
      <main className="min-h-screen bg-background">
        <Story />
      </main>
    ),
  ],
  component: ShellDialogsHarness,
  args: {
    rpc,
    spaces: [SPACE, SUPPORT],
    bots: BOTS,
    activeId: CHIEF.id,
    activeGroupId: undefined,
    alive: { current: true },
    navigate: fn(),
    setPanel: fn(),
    refreshBots: fn(async () => undefined),
    removeSpace: fn(async () => undefined),
    openSpaceSettings: fn(),
    closeMobileSidebar: fn(),
    createBot: fn(async () => undefined),
    botAvatarSet: DEFAULT_NEW_BOT_AVATAR_SET,
    clearOpenThread: fn(),
    discardChatAttachments: fn(),
    deleteRoutineDialogProps: null,
    paletteActions: [
      { id: "new-group", label: "New group chat", icon: Users, onSelect: fn() },
      { id: "connect-apps", label: "Connect apps", icon: Plug, onSelect: fn() },
    ],
  },
  parameters: { api: api({ pages: { list: { items: PAGES, nextCursor: null } } }) },
} satisfies Meta<typeof ShellDialogsHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SpaceMenu: Story = {
  args: {
    setup: (dialogs) => dialogs.setSpaceMenu({ id: SUPPORT.id, position: { x: 240, y: 160 } }),
  },
};

export const CommandPalette: Story = {
  args: { setup: (dialogs) => dialogs.setCommandPaletteOpen(true) },
};

export const DeleteSection: Story = {
  args: {
    setup: (dialogs) => dialogs.setDeleteSectionTarget({ section: SECTION, spaceId: SPACE_ID }),
  },
  parameters: {
    api: api({ botSections: { remove: { id: SECTION.id, releasedBots: 2, releasedGroups: 0 } } }),
  },
};

export const DeleteSpace: Story = {
  args: { setup: (dialogs) => dialogs.setDeleteSpaceTarget(SUPPORT) },
};

export const NewSpace: Story = {
  args: { setup: (dialogs) => dialogs.setNewSpaceOpen(true) },
  parameters: {
    api: api({
      spaces: { create: SUPPORT },
      availability: {
        items: [
          {
            kind: "skill",
            id: "skill-1",
            name: "Weekly report",
            availability: { allSpaces: true, spaceIds: [SPACE_ID] },
          },
          {
            kind: "mcpServer",
            id: "mcp-1",
            name: "Example Docs",
            availability: { allSpaces: false, spaceIds: [SPACE_ID] },
          },
        ],
        chooseForSpace: () => new Promise(() => {}),
      },
    }),
  },
  play: async () => {
    await userEvent.type(await screen.findByLabelText("Name"), "Customer support");
    await userEvent.click(screen.getByRole("button", { name: "Create space" }));
    await screen.findByText("What can this space use?");
  },
};
