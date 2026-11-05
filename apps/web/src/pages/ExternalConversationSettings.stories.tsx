import type { ExternalConversation } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { CHIEF, NOW, SPACE_ID } from "../storybook/fixtures";
import { ExternalConversationSettings } from "./ExternalConversationSettings";

const BOT = {
  ...CHIEF,
  teamChatAmbientEnabled: true,
  teamChatRules: "Answer planning questions and keep replies short.",
};

const ROOM: ExternalConversation = {
  id: "room-1",
  spaceId: SPACE_ID,
  botId: CHIEF.id,
  provider: "example",
  displayName: "#launch",
  participantNames: ["Ada Park", "Ben Ortiz", "Chen Wu"],
  teamChatAmbientEnabled: null,
  teamChatRules: null,
  automatedSenderPolicies: {},
  automatedSenders: [],
  threadId: "thread-room-1",
  preview: "Ada: the launch post is drafted.",
  unread: false,
  updatedAt: NOW,
};

const meta = {
  title: "Settings/External conversations",
  component: ExternalConversationSettings,
  parameters: { layout: "padded" },
  args: { conversation: ROOM, bot: BOT, onSave: fn(async () => {}) },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ExternalConversationSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FollowsBot: Story = {};

export const RoomOverride: Story = {
  args: {
    conversation: {
      ...ROOM,
      teamChatAmbientEnabled: false,
      teamChatRules: "Only answer questions about the launch schedule.",
    },
  },
};

export const AutomatedSenders: Story = {
  args: {
    conversation: {
      ...ROOM,
      automatedSenderPolicies: {
        "sender-deploys": { name: "Deploy notices", mode: "rollup", rollupHours: 12 },
        "sender-alerts": { name: "Uptime alerts", mode: "action" },
      },
      automatedSenders: [
        { id: "sender-deploys", name: "Deploy notices" },
        { id: "sender-alerts", name: "Uptime alerts" },
        { id: "sender-calendar", name: "Calendar reminders" },
      ],
    },
  },
};

export const Unnamed: Story = {
  args: { conversation: { ...ROOM, displayName: null, participantNames: ["Ada Park"] } },
};

export const Saving: Story = {
  args: { onSave: fn(() => new Promise<void>(() => {})) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
  },
};

export const SaveFailed: Story = {
  args: { onSave: fn(async () => Promise.reject(new Error("This room is no longer connected."))) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
  },
};
