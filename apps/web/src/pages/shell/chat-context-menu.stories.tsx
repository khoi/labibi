import type { BotSection } from "@labradoodle/contracts";
import { ContextMenu, ContextMenuTrigger } from "@labradoodle/ui-web";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { Suspense } from "react";
import { fn } from "storybook/test";
import { rpc } from "../../lib/rpc";
import { api } from "../../storybook/api";
import { CHIEF, GROUP, NOW, SCOUT, SPACE_ID } from "../../storybook/fixtures";
import { ChatContextMenu } from "./chat-context-menu";
import { useShellDialogs } from "./shell-dialogs";

function RosterRowMenu(props: Omit<ComponentProps<typeof ChatContextMenu>, "rpc" | "dialogs">) {
  const dialogs = useShellDialogs();
  const chat = props.bot ?? props.group;
  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-64 rounded-xl bg-muted px-4 py-3 text-[15px] text-foreground">
        {chat?.name}
      </ContextMenuTrigger>
      <Suspense fallback={null}>
        <ChatContextMenu {...props} rpc={rpc} dialogs={dialogs} />
      </Suspense>
    </ContextMenu>
  );
}

const SECTIONS: BotSection[] = [
  { id: "section-1", name: "Research", position: 0, createdAt: NOW, updatedAt: NOW },
  { id: "section-2", name: "Finance", position: 1, createdAt: NOW, updatedAt: NOW },
];

const meta = {
  title: "Chat/Chat context menu",
  component: RosterRowMenu,
  parameters: {
    layout: "padded",
    api: api({
      bots: {
        update: (input) => ({ ...CHIEF, ...input, id: input.botId }),
        duplicate: (input) => ({ ...CHIEF, id: `${input.botId}-copy`, name: "Chief copy" }),
        archive: { ok: true },
      },
      groups: {
        update: (input) => ({ ...GROUP, ...input, id: input.groupId }),
        duplicate: () => ({ ...GROUP, id: "group-copy", name: "Launch team copy" }),
        archive: { ok: true },
      },
    }),
  },
  args: {
    bot: CHIEF,
    group: undefined,
    sections: SECTIONS,
    spaceId: SPACE_ID,
    onClose: fn(),
    refreshBots: fn(async () => {}),
    read: {
      markBotRead: fn(async () => null),
      markBotUnread: fn(async () => {}),
      toggleGroupUnread: fn(),
    },
    openChatSettings: fn(),
    navigate: fn(),
  },
  play: async ({ canvas, userEvent }) => {
    const row = canvas.getByText(/Chief|Scout|Launch/);
    const { right, top, height } = row.getBoundingClientRect();
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: row,
      coords: { clientX: right - 24, clientY: top + height / 2 },
    });
  },
} satisfies Meta<typeof RosterRowMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PinnedBot: Story = {};

export const UnreadBotInSection: Story = {
  args: { bot: { ...SCOUT, sectionId: "section-1" } },
};

export const Group: Story = { args: { bot: undefined, group: GROUP } };
