import { BotAvatarActivityProvider } from "@labradoodle/ui-web";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { CHIEF, LEDGER, SCOUT } from "../../storybook/fixtures";
import { ActiveBotGlyph, CollaborationMarker } from "./CollaborationMarker";

const meta = {
  title: "Primitives/Collaboration marker",
  component: CollaborationMarker,
  parameters: { layout: "padded" },
  args: {
    peerName: SCOUT.name,
    color: SCOUT.color,
    identity: SCOUT.id,
    label: `Message from ${SCOUT.name}`,
    onClick: fn(),
  },
} satisfies Meta<typeof CollaborationMarker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Received: Story = {};

export const Sent: Story = {
  args: {
    peerName: LEDGER.name,
    color: LEDGER.color,
    identity: LEDGER.id,
    label: `Messaged ${LEDGER.name}`,
  },
};

export const Exchange: Story = { args: { label: `3 messages with ${SCOUT.name}` } };

export const LongName: Story = {
  args: {
    peerName: "Quarterly Revenue Forecasting Assistant",
    label: "Message from Quarterly Revenue Forecasting Assistant",
  },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
};

export const ActiveBot: Story = {
  render: () => (
    <ActiveBotGlyph
      bots={[{ botId: CHIEF.id, color: CHIEF.color, status: "running" }]}
      label="Reading quarterly-report.md"
    />
  ),
};

export const ActiveBots: Story = {
  render: () => (
    <BotAvatarActivityProvider
      source={{ subscribe: () => () => {}, getActivity: () => "thinking" }}
    >
      <ActiveBotGlyph
        bots={[
          { botId: CHIEF.id, color: CHIEF.color, status: "running" },
          { botId: SCOUT.id, color: SCOUT.color, status: "running" },
        ]}
        label="Thinking…"
      />
    </BotAvatarActivityProvider>
  ),
};
