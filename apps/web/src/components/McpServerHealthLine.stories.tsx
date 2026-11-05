import { MCP_OAUTH_CLIENT_REQUIRED } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { McpServerHealthLine } from "./McpServerHealthLine";

const meta = {
  title: "Chat/MCP server health",
  component: McpServerHealthLine,
  parameters: { layout: "padded" },
  args: {
    health: { status: "unknown", message: null, toolCount: null, checkedAt: null },
    checking: false,
  },
} satisfies Meta<typeof McpServerHealthLine>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotChecked: Story = {};

export const Checking: Story = { args: { checking: true } };

export const Installing: Story = {
  args: { health: { status: "installing", message: null, toolCount: null, checkedAt: null } },
};

export const NotWorking: Story = {
  args: {
    health: {
      status: "error",
      message:
        "Error: connect ECONNREFUSED 127.0.0.1:8931\n    at weather-mcp/server.js:42:11\nProcess exited with code 1",
      toolCount: null,
      checkedAt: "2026-10-26T08:55:00.000Z",
    },
  },
};

export const NeedsOAuthClient: Story = {
  args: {
    health: {
      status: "error",
      code: MCP_OAUTH_CLIENT_REQUIRED,
      message: null,
      toolCount: null,
      checkedAt: "2026-10-26T08:55:00.000Z",
    },
  },
};
