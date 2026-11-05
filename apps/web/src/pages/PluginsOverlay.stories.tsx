import type {
  Connection,
  ConnectionCatalogItem,
  McpServer,
  PluginMarketplaceEntry,
  SpaceNavigation,
} from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { api } from "../storybook/api";
import { BOTS, GROUP, NOW, SPACE, SPACE_ID } from "../storybook/fixtures";
import { PluginsOverlay } from "./PluginsOverlay";

function app(slug: string, name: string, connected = false): ConnectionCatalogItem {
  return { connectorId: "managed", slug, name, logo: null, connected, noAuth: false };
}

const CATALOG: ConnectionCatalogItem[] = [
  app("example-mail", "Example Mail", true),
  app("example-calendar", "Example Calendar"),
  app("sample-crm", "Sample CRM"),
  app("demo-tickets", "Demo Tickets"),
  app("test-docs", "Test Docs"),
  app("example-chat", "Example Chat"),
];

const CONNECTIONS: Connection[] = [
  {
    id: "connection-1",
    connectorId: "managed",
    provider: "example-mail",
    displayName: "ada@example.test",
    status: "connected",
    capabilities: [],
    createdAt: NOW,
  },
];

function plugin(
  name: string,
  displayName: string,
  category: string | null,
  description: string,
): PluginMarketplaceEntry {
  return {
    id: name,
    name,
    displayName,
    description,
    keywords: [],
    category,
    logo: null,
    homepage: `https://${name}.example.test`,
    domains: [`${name}.example.test`],
    registry: "example-registry",
    source: `example-registry/${name}`,
    installedSource: `example-registry/${name}`,
    hasConnector: true,
    skillCount: 2,
  };
}

const PLUGINS: PluginMarketplaceEntry[] = [
  plugin("ledger-books", "Ledger Books", "finance", "Invoices, expenses and reports."),
  plugin("pipeline-hub", "Pipeline Hub", "sales", "Deals, contacts and follow-ups."),
  plugin("canvas-board", "Canvas Board", "design", "Shared boards and mockups."),
  plugin("build-runner", "Build Runner", "code", "Builds, deploys and logs."),
];

const STANDALONE: McpServer = {
  id: "mcp-notes",
  spaceId: SPACE_ID,
  installId: null,
  slug: "team-notes",
  name: "Team notes",
  description: "",
  transport: "streamable_http",
  endpoint: "https://notes.example.test/mcp",
  command: null,
  hasArgs: false,
  envKeys: [],
  fileKeys: [],
  headerKeys: [],
  hasSecret: false,
  oauthStatus: "none",
  oauthClientId: null,
  health: { status: "ok", message: null, code: null, toolCount: 8, checkedAt: NOW },
  enabled: true,
  verbatimResults: false,
  revision: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

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

function pluginsApi({
  catalog = CATALOG,
  connections = CONNECTIONS,
  plugins = PLUGINS,
  servers = [STANDALONE],
}: {
  catalog?: ConnectionCatalogItem[];
  connections?: Connection[];
  plugins?: PluginMarketplaceEntry[];
  servers?: McpServer[];
} = {}) {
  return api({
    spaces: { list: NAVIGATION },
    mcp: { servers: { list: servers } },
    connections: {
      catalog,
      list: connections,
      tools: [
        { name: "EXAMPLE_MAIL_SEND", description: "Send a message." },
        { name: "EXAMPLE_MAIL_SEARCH", description: "Search messages." },
      ],
    },
    capabilities: { list: [], catalogSearch: { enabled: false, results: [] } },
    marketplace: {
      catalog: { entries: plugins, unavailableRegistries: [], skippedEntries: 0 },
    },
  });
}

const meta = {
  title: "Settings/Plugins",
  component: PluginsOverlay,
  parameters: { api: pluginsApi() },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background">
        <Story />
      </div>
    ),
  ],
  args: { onClose: fn(), onOpenMcp: fn(), onConnectedAppsChange: fn() },
} satisfies Meta<typeof PluginsOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Browse: Story = {};

export const PluginsOnly: Story = {
  parameters: { api: pluginsApi({ catalog: [], connections: [], servers: [] }) },
};

export const NothingConfigured: Story = {
  parameters: { api: pluginsApi({ catalog: [], connections: [], plugins: [], servers: [] }) },
};

export const Connected: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole("button", { name: /connected/ }));
  },
};

export const Loading: Story = {
  parameters: { api: api({ connections: { catalog: () => new Promise(() => {}) } }) },
};

export const LoadFailed: Story = {
  parameters: {
    api: api({
      connections: {
        catalog: () => {
          throw new ORPCError("BAD_REQUEST", { message: "The app catalog is unavailable." });
        },
      },
    }),
  },
};
