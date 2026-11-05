import { BOT_COLOR_LIST } from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { rpc } from "../../lib/rpc";
import { api } from "../../storybook/api";
import { bot, GROUP, LEDGER, NOW, SCOUT } from "../../storybook/fixtures";
import { ArchivedChats } from "./archived-chats";

const archivedAt = NOW;

const archivedBots = [
  { ...SCOUT, unread: false, archivedAt },
  { ...LEDGER, status: "idle", archivedAt },
  bot({
    id: "bot-archived-1",
    name: "Seasonal campaign planner for the spring launch",
    color: BOT_COLOR_LIST[4]!.hex,
    archivedAt,
  }),
];

const archivedGroups = [{ ...GROUP, archivedAt }];

const meta = {
  title: "Shell/Archived chats",
  component: ArchivedChats,
  parameters: {
    layout: "padded",
    api: api({
      bots: { restore: { ok: true } },
      groups: { restore: { ok: true } },
    }),
  },
  decorators: [
    (Story) => (
      <div className="rounded-xl bg-sidebar px-2.5 pb-2.5" style={{ width: 300 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    archivedBots,
    archivedGroups,
    showSpaceSearch: false,
    rpc,
    refreshBots: fn(async () => undefined),
    setDeleteTarget: fn(),
    setDeleteGroupTarget: fn(),
  },
} satisfies Meta<typeof ArchivedChats>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};

export const Expanded: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Archived/ }));
  },
};

export const OnlyGroups: Story = {
  args: { archivedBots: [] },
  play: Expanded.play,
};
