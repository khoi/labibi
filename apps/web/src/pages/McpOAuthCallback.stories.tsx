import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { MCP_OAUTH_CHANNEL } from "../lib/mcp-connect";
import { api } from "../storybook/api";
import { McpOAuthCallbackPage } from "./McpOAuthCallback";

const meta = {
  title: "Views/MCP OAuth callback",
  component: McpOAuthCallbackPage,
  parameters: {
    route: "/mcp/oauth/callback?code=story-code&state=session-1",
    api: api({ mcp: { oauth: { complete: () => new Promise(() => {}) } } }),
  },
} satisfies Meta<typeof McpOAuthCallbackPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Finishing: Story = {};

export const ConnectedInPopup: Story = {
  parameters: { api: api({ mcp: { oauth: { complete: { ok: true } } } }) },
  beforeEach: () => {
    const { name, close } = window;
    window.name = MCP_OAUTH_CHANNEL;
    window.close = fn().mockName("window.close");
    return () => {
      window.name = name;
      window.close = close;
    };
  },
};

export const Failed: Story = {
  parameters: {
    api: api({
      mcp: {
        oauth: {
          complete: () => {
            throw new ORPCError("BAD_REQUEST", { message: "The authorization code expired." });
          },
        },
      },
    }),
  },
};

export const Denied: Story = {
  parameters: {
    route: "/mcp/oauth/callback?error=access_denied&error_description=The+request+was+denied.",
  },
};
