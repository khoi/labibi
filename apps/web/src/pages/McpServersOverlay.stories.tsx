import type { BotMcpServer, McpServer, SpaceNavigation } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { api } from "../storybook/api";
import { BOTS, CHIEF, GROUP, NOW, SPACE, SPACE_ID } from "../storybook/fixtures";
import { McpServersOverlay } from "./McpServersOverlay";

function server(overrides: Partial<McpServer> & Pick<McpServer, "id" | "name">): McpServer {
  return {
    spaceId: SPACE_ID,
    installId: null,
    slug: overrides.name.toLowerCase().replaceAll(" ", "-"),
    description: "",
    transport: "streamable_http",
    endpoint: `https://${overrides.id}.example.test/mcp`,
    command: null,
    hasArgs: false,
    envKeys: [],
    fileKeys: [],
    headerKeys: [],
    hasSecret: false,
    oauthStatus: "none",
    oauthClientId: null,
    health: { status: "ok", message: null, code: null, toolCount: 12, checkedAt: NOW },
    enabled: true,
    verbatimResults: false,
    revision: 1,
    allBots: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const SERVERS: McpServer[] = [
  server({ id: "notes", name: "Team notes", headerKeys: ["Authorization"], hasSecret: true }),
  server({
    id: "tickets",
    name: "Tickets",
    oauthStatus: "reconnect",
    health: {
      status: "error",
      message: "The sign-in expired.",
      code: null,
      toolCount: null,
      checkedAt: NOW,
    },
  }),
  server({
    id: "files",
    name: "Local files",
    transport: "stdio",
    endpoint: null,
    command: "/opt/mcp/files-server",
    hasArgs: true,
    envKeys: ["ROOT_DIR"],
    allBots: false,
    health: { status: "unknown", message: null, code: null, toolCount: null, checkedAt: null },
  }),
];

const ASSIGNMENTS: BotMcpServer[] = [
  {
    id: "assignment-1",
    botId: CHIEF.id,
    serverId: "files",
    allowAllTools: true,
    allowedTools: [],
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const NAVIGATION: SpaceNavigation = {
  current: {
    id: SPACE.id,
    name: SPACE.name,
    bots: BOTS,
    groups: [GROUP],
    externalConversations: [],
    botSections: [],
  },
  spaces: [SPACE],
};

const meta = {
  title: "Settings/MCP servers",
  component: McpServersOverlay,
  parameters: {
    api: api({
      spaces: { list: NAVIGATION },
      bots: { list: BOTS },
      mcp: {
        servers: {
          list: SERVERS,
          test: (input) => SERVERS.find((entry) => entry.id === input.id) ?? SERVERS[0]!,
        },
        assignments: { all: ASSIGNMENTS },
      },
    }),
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background">
        <Story />
      </div>
    ),
  ],
  args: { stdioEnabled: true, onClose: fn() },
} satisfies Meta<typeof McpServersOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Servers: Story = {};

export const Empty: Story = {
  parameters: { api: api({ mcp: { servers: { list: [] }, assignments: { all: [] } } }) },
};

export const EditingServer: Story = { args: { editServerId: "notes" } };

export const AddingStdioServer: Story = {
  parameters: { api: api({ mcp: { servers: { list: [] }, assignments: { all: [] } } }) },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole("tab", { name: "STDIO" }));
  },
};

export const StdioUnavailable: Story = {
  args: { stdioEnabled: false },
  parameters: { api: api({ mcp: { servers: { list: [] }, assignments: { all: [] } } }) },
};

export const LoadFailed: Story = {
  parameters: {
    api: api({
      mcp: {
        servers: {
          list: () => {
            throw new ORPCError("FORBIDDEN", { message: "Not allowed" });
          },
        },
      },
    }),
  },
};
