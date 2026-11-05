import type { ThreadMessage } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../storybook/api";
import { CHIEF, LEDGER, message, SCOUT } from "../storybook/fixtures";
import { PeerMessagesOverlay } from "./PeerMessagesOverlay";

const sent = (text: string) =>
  message("bot", [{ kind: "bot_message_sent", toBotId: SCOUT.id, toBotName: SCOUT.name, text }]);
const received = (text: string) =>
  message("system", [
    { kind: "bot_message_received", fromBotId: SCOUT.id, fromBotName: SCOUT.name, text },
  ]);

const EXCHANGE: ThreadMessage[] = [
  sent("Can you find three recent sources on customer churn for the Q3 report?"),
  received(
    "Found three:\n\n1. A **retention survey** from the spring\n2. The support ticket trends\n3. Last quarter's cancellation notes",
  ),
  sent("Thanks. Which one shows the biggest change?"),
  received("The cancellation notes. Churn reasons shifted from price to missing features."),
  sent("Great, I'll lead the summary with that."),
];

const page = (messages: ThreadMessage[]) => ({
  threadId: CHIEF.threadId,
  messages,
  olderCursor: null,
});

const meta = {
  title: "Panels/Peer messages",
  component: PeerMessagesOverlay,
  args: {
    botId: CHIEF.id,
    botName: CHIEF.name,
    botColor: CHIEF.color,
    peerBotId: SCOUT.id,
    peerBotName: SCOUT.name,
    peerBotColor: SCOUT.color,
    onClose: fn(),
  },
  parameters: { api: api({ threads: { messages: page(EXCHANGE) } }) },
  decorators: [
    (Story) => (
      <div className="h-screen bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PeerMessagesOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Conversation: Story = {};

export const NoMessages: Story = {
  args: {
    peerBotId: LEDGER.id,
    peerBotName: LEDGER.name,
    peerBotColor: LEDGER.color,
  },
};

export const Loading: Story = {
  parameters: { api: api({ threads: { messages: () => new Promise(() => {}) } }) },
};

export const LoadError: Story = {
  parameters: {
    api: api({
      threads: {
        messages: () => {
          throw new ORPCError("FORBIDDEN", { message: "Could not load this chat." });
        },
      },
    }),
  },
};
