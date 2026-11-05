import { cn } from "@labradoodle/ui-web";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";
import { rpc } from "../../lib/rpc";
import { BOTS, CHIEF, GROUP, message, SCOUT, say } from "../../storybook/fixtures";
import { MessageView } from "./message-view";
import { bubbleFrameWidth } from "./transcript";

function MessageViewStory(props: Omit<ComponentProps<typeof MessageView>, "rpc">) {
  return (
    <div
      className={cn(
        "group/message flex",
        props.message.role === "user" ? "justify-end" : "justify-start",
      )}
    >
      <div className={cn("relative w-fit min-w-0", bubbleFrameWidth(props.message.role))}>
        <MessageView {...props} rpc={rpc} />
      </div>
    </div>
  );
}

const parent = say("bot", "Here's the plan:\n\n1. Pull revenue\n2. Draft the summary");
const findBot = (botId: string | undefined) => BOTS.find((item) => item.id === botId);

const meta = {
  title: "Chat/Message view",
  component: MessageViewStory,
  parameters: { layout: "padded" },
  args: {
    message: say(
      "bot",
      "Sure. Here's the plan:\n\n1. Pull revenue and churn from the **finance sheet**\n2. Draft the summary\n3. Send it to you for review",
    ),
    artifactTarget: { botId: CHIEF.id },
    canAnswer: false,
    canDismiss: false,
    showToolActivity: true,
    voiceReady: false,
    speaking: false,
    peerBot: (botId) => findBot(botId),
    onAnswer: fn(async () => {}),
    onOpenBot: fn(),
    onOpenPeerMessages: fn(),
    onJumpToMessage: fn(),
    onRefresh: fn(async () => {}),
    onBotChanged: fn(async () => {}),
    onAddRoutine: fn(),
    onSpeak: fn(),
    onOpenComputer: fn(),
    onOpenImportSetup: fn(),
    onReply: fn(),
    onMarkUnread: fn(),
    onReact: fn(async () => {}),
  },
} satisfies Meta<typeof MessageViewStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BotReply: Story = {};

export const UserReply: Story = {
  args: {
    message: say("user", "Keep the summary short.", {
      replyToMessageId: parent.id,
      replyQuote: "Draft the summary",
      replyPreview: { role: "bot", botId: CHIEF.id, text: "Draft the summary" },
    }),
    replyParent: parent,
  },
};

export const GroupSpeaker: Story = {
  args: {
    message: say("bot", "The draft is ready for review.", {
      threadId: GROUP.threadId,
      botId: SCOUT.id,
    }),
    artifactTarget: { groupId: GROUP.id },
    speakerName: SCOUT.name,
  },
};

export const MentionsABot: Story = {
  args: {
    message: say("bot", "I set up Scout to compare venues and Planner to book the room."),
    mentions: [
      { kind: "child_bot", botId: SCOUT.id, name: SCOUT.name, status: "created" },
      { kind: "child_bot", botId: "bot-9", name: "Planner", status: "archived" },
    ],
  },
};

export const Speaking: Story = {
  args: { voiceReady: true, speaking: true },
};

export const PendingQuestion: Story = {
  args: {
    message: message("bot", [
      {
        kind: "ask",
        text: "Which calendar should I use?",
        status: "pending",
        actions: [
          { id: "work", label: "Work" },
          { id: "personal", label: "Personal" },
        ],
      },
    ]),
    canAnswer: true,
    canDismiss: true,
  },
};

export const ComputerNeedsYou: Story = {
  args: {
    message: message("bot", [
      { kind: "computer", state: "Needs you", text: "The site wants a captcha solved." },
    ]),
  },
};

export const LiveProgress: Story = {
  args: {
    message: message(
      "bot",
      [
        { kind: "steps", steps: [{ label: "Open calendar", count: 1 }] },
        { kind: "progress", text: "Checking Sam's calendar…" },
      ],
      { id: "progress:run-1" },
    ),
  },
};
