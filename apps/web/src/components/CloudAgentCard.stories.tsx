import type { Meta, StoryObj } from "@storybook/react-vite";
import { CloudAgentCard } from "./CloudAgentCard";

const meta = {
  title: "Chat/Cloud agent card",
  component: CloudAgentCard,
  parameters: { layout: "padded" },
  args: {
    block: {
      kind: "cloud_agent",
      agentId: "cloud-1",
      title: "Fix flaky calendar test",
      status: "running",
      url: "https://example.test/agents/cloud-1",
      branch: "fix/calendar-test",
    },
  },
} satisfies Meta<typeof CloudAgentCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};

export const Finished: Story = {
  args: {
    block: {
      kind: "cloud_agent",
      agentId: "cloud-2",
      title: "Add CSV export",
      status: "finished",
      url: "https://example.test/agents/cloud-2",
      prUrl: "https://example.test/pull/42",
    },
  },
};

export const Failed: Story = {
  args: {
    block: {
      kind: "cloud_agent",
      agentId: "cloud-3",
      title: "Upgrade the date library",
      status: "failed",
      url: "https://example.test/agents/cloud-3",
      branch: "chore/date-library",
    },
  },
};

export const Expired: Story = {
  args: {
    block: {
      kind: "cloud_agent",
      agentId: "cloud-4",
      title: "Clean up unused styles",
      status: "expired",
      url: "",
    },
  },
};
