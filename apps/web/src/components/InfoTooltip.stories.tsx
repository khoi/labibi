import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { InfoTooltip } from "./InfoTooltip";

const meta = {
  title: "Primitives/Info tooltip",
  component: InfoTooltip,
  parameters: { layout: "centered" },
  args: {
    label: "Notifications",
    children: "Get notified when this bot finishes or needs input.",
  },
  decorators: [
    (Story, { args }) => (
      <div className="flex items-center gap-2 text-[14px] text-foreground">
        {args.label}
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InfoTooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Pinned: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button"));
  },
};

export const LongHelp: Story = {
  args: {
    label: "Context limit",
    children:
      "The most tokens the model reads at once, counting the conversation, attached files and tool results. Older messages are summarized when a chat grows past it.",
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button"));
  },
};
