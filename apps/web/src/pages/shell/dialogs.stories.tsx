import type { AccountItem, BotSection } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, screen, userEvent } from "storybook/test";
import { CHIEF, GROUP, NOW, SCOUT, SPACE_ID } from "../../storybook/fixtures";
import {
  ClearConversationDialog,
  DeleteBotDialog,
  DeleteItemDialog,
  DeleteSpaceDialog,
  NewBotSectionDialog,
  NewSpaceDialog,
  RenameBotSectionDialog,
} from "./dialogs";

const ITEMS: AccountItem[] = [
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
  {
    kind: "install",
    id: "install-1",
    name: "Example Calendar",
    availability: { allSpaces: true, spaceIds: [SPACE_ID] },
  },
];

const SECTION: BotSection = {
  id: "section-1",
  name: "Research",
  position: 0,
  createdAt: NOW,
  updatedAt: NOW,
};

const rejects = (message: string) =>
  fn(async () => {
    throw new Error(message);
  });

const meta = {
  title: "Shell/Dialogs",
  decorators: [
    (Story) => (
      <main className="min-h-screen bg-background">
        <Story />
      </main>
    ),
  ],
  component: NewSpaceDialog,
  args: {
    onCancel: fn(),
    onCreate: fn(async () => "space-2"),
    loadItems: fn(async () => []),
    chooseItems: fn(async () => undefined),
    onDone: fn(),
  },
} satisfies Meta<typeof NewSpaceDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewSpace: Story = {};

export const NewSpaceChooseItems: Story = {
  args: { loadItems: fn(async () => ITEMS) },
  play: async () => {
    await userEvent.type(await screen.findByLabelText("Name"), "Customer support");
    await userEvent.click(screen.getByRole("button", { name: "Create space" }));
    await screen.findByText("What can this space use?");
  },
};

export const NewSpaceError: Story = {
  args: { onCreate: rejects("A space with this name already exists.") },
  play: async () => {
    await userEvent.type(await screen.findByLabelText("Name"), "Personal");
    await userEvent.click(screen.getByRole("button", { name: "Create space" }));
    await screen.findByText("A space with this name already exists.");
  },
};

export const NewSection: Story = {
  render: () => (
    <NewBotSectionDialog bot={SCOUT} onCancel={fn()} onConfirm={fn(async () => undefined)} />
  ),
};

export const RenameSection: Story = {
  render: () => (
    <RenameBotSectionDialog
      section={SECTION}
      onCancel={fn()}
      onConfirm={fn(async () => undefined)}
    />
  ),
};

export const ClearConversation: Story = {
  render: () => (
    <ClearConversationDialog bot={CHIEF} onCancel={fn()} onConfirm={fn(async () => undefined)} />
  ),
};

export const DeleteBot: Story = {
  render: () => (
    <DeleteBotDialog bot={SCOUT} onCancel={fn()} onConfirm={fn(async () => undefined)} />
  ),
};

export const DeleteBotError: Story = {
  render: () => (
    <DeleteBotDialog
      bot={SCOUT}
      onCancel={fn()}
      onConfirm={rejects("Scout is still running. Stop it first.")}
    />
  ),
  play: async () => {
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await screen.findByText("Scout is still running. Stop it first.");
  },
};

export const DeleteSpace: Story = {
  render: () => (
    <DeleteSpaceDialog
      space={{ id: "space-2", name: "Customer support", canDelete: true, botCount: 3 }}
      onCancel={fn()}
      onConfirm={fn(async () => undefined)}
    />
  ),
};

export const DeleteGroup: Story = {
  render: () => (
    <DeleteItemDialog
      item={GROUP}
      noun="group"
      onCancel={fn()}
      onConfirm={fn(async () => undefined)}
    />
  ),
};
