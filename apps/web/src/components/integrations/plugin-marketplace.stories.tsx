import type { CapabilityInstall, McpServer, PluginPreview } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../../storybook/api";
import { BOTS, CHIEF, GROUP, NOW, SPACE, SPACE_ID } from "../../storybook/fixtures";
import { PluginDetail, PluginRow } from "./plugin-marketplace";

const SOURCE = "https://git.example.test/example/notes";
const SHA = "a".repeat(40);

const PREVIEW: PluginPreview = {
  format: "agent-plugins",
  name: "notes",
  version: "1.0.0",
  description: "Plan the day, keep meeting notes and turn them into tasks.",
  author: null,
  homepage: null,
  repository: null,
  license: null,
  keywords: [],
  resolvedSha: SHA,
  pinnedSource: `${SOURCE}@${SHA}`,
  digest: `sha256:${"b".repeat(64)}`,
  skills: [
    { name: "daily-plan", description: "Draft a plan for the day from open tasks" },
    {
      name: "meeting-notes",
      description: "Summarize a meeting into notes",
      files: ["template.md"],
    },
    { name: "weekly-review", description: "Review the week and carry tasks over" },
    { name: "inbox-zero", description: "Sort captured notes into projects" },
    { name: "decision-log", description: "Record a decision and why it was made" },
    { name: "standup", description: "Write a short standup update" },
    { name: "retro", description: "Collect what went well and what to change" },
  ],
  mcpServers: [
    {
      name: "notes-mcp",
      transport: "streamable_http",
      endpoint: "https://notes.example.test/mcp",
      staticHeaderKeys: [],
    },
  ],
  skipped: [],
};

const INSTALL: CapabilityInstall = {
  id: "plugin-1",
  kind: "plugin",
  name: "notes",
  source: SOURCE,
  version: SHA,
  digest: PREVIEW.digest,
  secretConfigured: false,
  config: PREVIEW,
  createdAt: NOW,
};

const SERVER: McpServer = {
  id: "server-1",
  spaceId: SPACE_ID,
  installId: INSTALL.id,
  slug: "notes-mcp",
  name: "notes: notes-mcp",
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
  health: { status: "unknown", message: null, toolCount: null, checkedAt: null },
  enabled: true,
  verbatimResults: false,
  revision: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

const meta = {
  title: "Integrations/Plugin detail",
  component: PluginDetail,
  parameters: {
    layout: "padded",
    api: api({
      spaces: {
        list: {
          current: {
            id: SPACE_ID,
            name: SPACE.name,
            bots: BOTS,
            groups: [GROUP],
            externalConversations: [],
            botSections: [],
          },
          spaces: [SPACE],
        },
      },
      capabilities: { pluginPreview: PREVIEW, install: INSTALL },
    }),
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: {
    selection: {
      source: SOURCE,
      installedSource: SOURCE,
      name: "Notes",
      description: "Plan the day and keep meeting notes.",
    },
    installs: [],
    servers: [],
    assigned: new Set<string>(),
    activeBotId: CHIEF.id,
    onBack: fn(),
    onChanged: fn(async () => undefined),
  },
} satisfies Meta<typeof PluginDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Preview: Story = {};

export const Loading: Story = {
  parameters: { api: api({ capabilities: { pluginPreview: () => new Promise(() => {}) } }) },
};

export const PreviewFailed: Story = {
  parameters: {
    api: api({
      capabilities: {
        pluginPreview: () => {
          throw new ORPCError("BAD_GATEWAY", { message: "The repository could not be read" });
        },
      },
    }),
  },
};

export const Installed: Story = {
  args: { installs: [INSTALL], servers: [SERVER] },
  parameters: {
    api: api({
      agentSkills: {
        list: PREVIEW.skills.map((skill, index) => ({
          id: `skill-${index}`,
          name: skill.name,
          description: skill.description,
          source: "plugin",
          readOnly: true,
        })),
        get: ({ skillId = "skill-0" }) => ({
          id: skillId,
          name: "daily-plan",
          description: "Draft a plan for the day from open tasks",
          content:
            "List today's open tasks, pick the three that matter most, and block time for each.",
          source: "plugin",
          readOnly: true,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      },
    }),
  },
};

export const SkillPack: Story = {
  parameters: {
    api: api({
      capabilities: {
        pluginPreview: {
          ...PREVIEW,
          mcpServers: [],
          skipped: [{ kind: "editor_only", name: "hooks/", reason: "Runs only inside an editor" }],
          builtinNames: ["summarize"],
        },
      },
    }),
  },
};

export const ManagedApp: Story = {
  args: {
    managed: {
      name: "Example Notes",
      logo: null,
      connected: false,
      connecting: false,
      onConnect: fn(),
      onManage: fn(),
    },
  },
};

export const Row: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-2">
      <PluginRow name="Notes" description="Plan the day" installed={false} onOpen={fn()} />
      <PluginRow name="Tasks" description="Projects and to-dos" installed onOpen={fn()} />
    </div>
  ),
};
