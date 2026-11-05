import type {
  AgentSkillCatalogEntry,
  CapabilityInstall,
  PluginMarketplaceEntry,
  PluginPreview,
} from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, screen } from "storybook/test";
import { api } from "../../storybook/api";
import { BOTS, GROUP, NOW, SPACE, SPACE_ID } from "../../storybook/fixtures";
import { SkillsDialog } from "./skills-dialog";

const pack = (name: string, displayName: string, description: string): PluginMarketplaceEntry => ({
  id: `catalog/${name}`,
  name,
  displayName,
  description,
  keywords: [],
  category: null,
  logo: null,
  homepage: null,
  domains: [],
  registry: "catalog",
  source: `https://git.example.test/example/${name}`,
  installedSource: `https://git.example.test/example/${name}`,
  hasConnector: false,
  skillCount: 4,
});

const PACKS = [
  pack("writing", "Writing", "Drafts, edits and tone checks"),
  pack("research", "Research", "Find sources and summarize them"),
  pack("planning", "Planning", "Plans, reviews and retros"),
  pack("support", "Support", "Answer customer questions"),
  pack("finance", "Finance", "Budgets, invoices and spend"),
];

const PLANNING: PluginPreview = {
  format: "agent-plugins",
  name: "planning",
  version: "1.0.0",
  description: "Plans, reviews and retros",
  author: null,
  homepage: null,
  repository: null,
  license: null,
  keywords: [],
  resolvedSha: "c".repeat(40),
  digest: `sha256:${"d".repeat(64)}`,
  skills: [
    { name: "daily-plan", description: "Draft a plan for the day" },
    { name: "weekly-review", description: "Review the week" },
    { name: "retro", description: "Run a short retro" },
  ],
  mcpServers: [],
  skipped: [],
};

const INSTALLED: CapabilityInstall = {
  id: "plugin-2",
  kind: "plugin",
  name: "planning",
  source: PACKS[2]!.installedSource,
  version: PLANNING.resolvedSha,
  digest: PLANNING.digest,
  secretConfigured: false,
  config: { ...PLANNING, parts: ["skills"] },
  createdAt: NOW,
};

const SKILLS: AgentSkillCatalogEntry[] = [
  {
    id: "skill-1",
    name: "release-notes",
    description: "Write release notes",
    source: "user",
    readOnly: false,
  },
  {
    id: "skill-2",
    name: "triage",
    description: "Sort new issues",
    source: "user",
    readOnly: false,
  },
];

const meta = {
  title: "Integrations/Skills dialog",
  component: SkillsDialog,
  args: { onClose: fn() },
  decorators: [
    (Story) => (
      <div className="min-h-screen">
        <Story />
      </div>
    ),
  ],
  parameters: {
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
      marketplace: { catalog: { entries: PACKS, unavailableRegistries: [], skippedEntries: 0 } },
      capabilities: { list: [INSTALLED], pluginPreview: PLANNING },
      agentSkills: { list: SKILLS },
    }),
  },
} satisfies Meta<typeof SkillsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  parameters: {
    api: api({
      marketplace: { catalog: { entries: [], unavailableRegistries: [], skippedEntries: 0 } },
      capabilities: { list: [] },
      agentSkills: { list: [] },
    }),
  },
};

export const LoadingCatalog: Story = {
  parameters: { api: api({ marketplace: { catalog: () => new Promise(() => {}) } }) },
};

export const CatalogPartlyUnavailable: Story = {
  parameters: {
    api: api({
      marketplace: {
        catalog: {
          entries: PACKS.slice(0, 2),
          unavailableRegistries: ["community"],
          skippedEntries: 0,
        },
      },
    }),
  },
};

export const OpenPlugin: Story = {
  play: async ({ userEvent }) => {
    await userEvent.click(await screen.findByTestId("plugin-skill-set"));
  },
};
