import type { MessageBlock } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../../storybook/api";
import { CHIEF, NOW } from "../../storybook/fixtures";
import {
  AppConnectCard,
  ArtifactImage,
  ChartBlockView,
  ChoiceCard,
  McpApprovalCard,
} from "./message-cards";

const IMAGE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="silver"/><circle cx="160" cy="150" r="70" fill="darkgray"/><rect x="250" y="90" width="150" height="120" rx="12" fill="gray"/></svg>';

const appConnect: Extract<MessageBlock, { kind: "app_connect" }> = {
  kind: "app_connect",
  provider: "example-docs",
  name: "Example Docs",
  description: "Read and update your pages",
  logo: null,
  status: "pending",
};

const mcpApproval: Extract<MessageBlock, { kind: "mcp_approval" }> = {
  kind: "mcp_approval",
  name: "Weather",
  serverId: "server-1",
  transport: "streamable_http",
  endpoint: "https://weather.example.test/mcp",
  needsOAuth: true,
  status: "pending",
};

const revenue = [
  { month: "Jul", revenue: 410 },
  { month: "Aug", revenue: 465 },
  { month: "Sep", revenue: 520 },
];

const meta = {
  title: "Chat/Message cards",
  component: ChoiceCard,
  parameters: { layout: "padded" },
  args: {
    botId: CHIEF.id,
    block: {
      kind: "choice",
      question: "What do you want me on first?",
      options: [
        { id: "day", letter: "A", label: "Day-to-day work" },
        { id: "inbox", letter: "B", label: "Inbox & email" },
        { id: "research", letter: "C", label: "Research & writing" },
        { id: "everything", letter: "D", label: "A bit of everything" },
      ],
    },
    onBotChanged: fn(async () => {}),
  },
} satisfies Meta<typeof ChoiceCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Choice: Story = {
  parameters: { api: api({ onboarding: { choose: { ok: true }, dismissFocus: { ok: true } } }) },
};

export const ChoiceAnswered: Story = {
  args: {
    block: {
      kind: "choice",
      question: "How often should I check in?",
      subtitle: "You can change this later.",
      options: [
        { id: "daily", letter: "A", label: "Daily" },
        { id: "weekly", letter: "B", label: "Weekly" },
      ],
      answerId: "weekly",
    },
  },
};

export const AppConnect: Story = {
  render: () => <AppConnectCard botId={CHIEF.id} threadId={CHIEF.threadId} block={appConnect} />,
};

export const AppConnected: Story = {
  render: () => (
    <AppConnectCard
      botId={CHIEF.id}
      threadId={CHIEF.threadId}
      block={{ ...appConnect, status: "connected" }}
    />
  ),
};

export const McpApproval: Story = {
  render: () => <McpApprovalCard botId={CHIEF.id} threadId={CHIEF.threadId} block={mcpApproval} />,
};

export const McpApprovalWithoutSignIn: Story = {
  render: () => (
    <McpApprovalCard
      botId={CHIEF.id}
      threadId={CHIEF.threadId}
      block={{ ...mcpApproval, needsOAuth: false, endpoint: null, transport: "stdio" }}
    />
  ),
};

export const McpApprovalDismissed: Story = {
  render: () => (
    <McpApprovalCard
      botId={CHIEF.id}
      threadId={CHIEF.threadId}
      block={{ ...mcpApproval, status: "dismissed" }}
    />
  ),
};

export const Chart: Story = {
  render: () => (
    <ChartBlockView
      name="Revenue by month"
      spec={{ marks: [{ type: "barY", options: { x: "month", y: "revenue" } }] }}
      data={revenue}
    />
  ),
};

export const ChartError: Story = {
  render: () => (
    <ChartBlockView
      name="Revenue by month"
      spec={{ marks: [{ type: "sparkle", options: { x: "month", y: "revenue" } }] }}
      data={revenue}
    />
  ),
};

export const Image: Story = {
  parameters: {
    api: api({
      artifacts: {
        get: (input) => ({
          id: input.artifactId,
          botId: CHIEF.id,
          groupId: null,
          runId: null,
          name: "whiteboard.svg",
          description: null,
          mimeType: "image/svg+xml",
          size: IMAGE_SVG.length,
          version: 1,
          createdAt: NOW,
          contentBase64: btoa(IMAGE_SVG),
        }),
      },
    }),
  },
  render: () => (
    <ArtifactImage target={{ botId: CHIEF.id }} artifactId="image-1" name="whiteboard.svg" />
  ),
};

export const ImageLoading: Story = {
  parameters: { api: api({ artifacts: { get: () => new Promise(() => {}) } }) },
  render: () => (
    <ArtifactImage target={{ botId: CHIEF.id }} artifactId="image-2" name="whiteboard.svg" />
  ),
};
