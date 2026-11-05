import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { CHIEF, GROUP, LEDGER } from "../../storybook/fixtures";
import { ChatHeader } from "./chat-header";

const meta = {
  title: "Chat/Chat header",
  component: ChatHeader,
  args: {
    inGroup: false,
    active: CHIEF,
    activeGroup: undefined,
    activeSnapshot: null,
    phoneCallsEnabled: false,
    voiceReady: false,
    inCall: false,
    panelOpen: false,
    onOpenNavigation: fn(),
    onTogglePanel: fn(),
    onCall: fn(),
  },
  decorators: [
    (Story) => (
      <div className="relative h-32 bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bot: Story = {};

export const BotWorking: Story = { args: { active: LEDGER } };

export const WithCall: Story = { args: { phoneCallsEnabled: true, voiceReady: true } };

export const InCall: Story = { args: { phoneCallsEnabled: true, voiceReady: true, inCall: true } };

export const Group: Story = { args: { inGroup: true, active: undefined, activeGroup: GROUP } };

export const NoBotSelected: Story = { args: { active: undefined } };

export const Phone: Story = {
  args: { phoneCallsEnabled: true, voiceReady: true },
  globals: { viewport: { value: "mobile2", isRotated: false } },
};
