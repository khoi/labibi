import type { BotSection } from "@labradoodle/contracts";
import { ContextMenu, ContextMenuTrigger } from "@labradoodle/ui-web";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, screen } from "storybook/test";
import { CHIEF, NOW, SCOUT } from "../storybook/fixtures";
import { BotContextMenu } from "./BotContextMenu";

const sections: BotSection[] = [
  { id: "section-1", name: "Research", position: 0, createdAt: NOW, updatedAt: NOW },
  { id: "section-2", name: "Operations", position: 1, createdAt: NOW, updatedAt: NOW },
];

const meta = {
  title: "Panels/Bot context menu",
  component: BotContextMenu,
  parameters: { layout: "padded" },
  args: {
    bot: CHIEF,
    sections,
    onClose: fn(),
    onTogglePinned: fn(),
    onMoveToSection: fn(),
    onCreateSection: fn(),
    onRenameSection: fn(),
    onToggleUnread: fn(),
    onEdit: fn(),
    onDuplicate: fn(),
    onClear: fn(),
    onArchive: fn(),
    onDelete: fn(),
  },
  render: (args) => (
    <ContextMenu>
      <ContextMenuTrigger className="block w-[260px] rounded-xl px-2.5 py-2.5 text-[15px] hover:bg-accent">
        {args.bot.name}
      </ContextMenuTrigger>
      <BotContextMenu {...args} />
    </ContextMenu>
  ),
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.pointer({ keys: "[MouseRight]", target: canvas.getByText(args.bot.name) });
    await screen.findByRole("menu");
  },
} satisfies Meta<typeof BotContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pinned: Story = {};

export const UnreadInSection: Story = {
  args: { bot: { ...SCOUT, sectionId: "section-1" } },
};

export const MoveToSection: Story = {
  args: { bot: { ...SCOUT, sectionId: "section-1" } },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.pointer({ keys: "[MouseRight]", target: canvas.getByText(args.bot.name) });
    await userEvent.hover(await screen.findByRole("menuitem", { name: "Move to" }));
    await screen.findByRole("menuitem", { name: "Rename section" });
  },
};
