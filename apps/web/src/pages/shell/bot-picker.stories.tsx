import { BOT_COLOR_LIST } from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { BOTS, bot } from "../../storybook/fixtures";
import { BotCreatePicker } from "./bot-picker";

const manyBots = [
  ...BOTS,
  ...["Atlas", "Beacon", "Courier", "Delta", "Ember", "Fable", "Garnet", "Juniper", "Kestrel"].map(
    (name, index) =>
      bot({
        id: `bot-many-${index}`,
        name,
        color: BOT_COLOR_LIST[(index + 3) % BOT_COLOR_LIST.length]!.hex,
      }),
  ),
];

const meta = {
  title: "Shell/Bot picker",
  component: BotCreatePicker,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="overflow-hidden rounded-xl border border-border bg-popover shadow-md">
        <Story />
      </div>
    ),
  ],
  args: {
    bots: BOTS,
    onCreateBot: fn(),
    onOpenBot: fn(),
    onCreateGroup: fn(),
    onCreateSpace: fn(),
  },
} satisfies Meta<typeof BotCreatePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ManyBots: Story = { args: { bots: manyBots } };

export const NoBots: Story = { args: { bots: [] } };
