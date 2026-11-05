import type {
  AgentSkillCatalogEntry,
  MemoryDocument,
  MemoryPromptBudget,
  SpaceNavigation,
} from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../storybook/api";
import { BOTS, CHIEF, GROUP, NOW, SPACE, SPACE_ID } from "../storybook/fixtures";
import { AgentSkills, KnowledgeSection, SpaceMemorySection } from "./KnowledgeSection";

function doc(id: string, path: string, content: string, botId: string | null): MemoryDocument {
  return { id, scope: botId ? "bot" : "user", botId, path, content, revision: 1, updatedAt: NOW };
}

const BOT_DOCS = [
  doc(
    "memory-index",
    "MEMORY.md",
    "# Chief\n\n- Ada prefers one-paragraph summaries.\n- Reports go out on Mondays.\n",
    CHIEF.id,
  ),
  doc(
    "memory-q3",
    "projects/q3-report.md",
    "Revenue and churn come from the finance sheet.",
    CHIEF.id,
  ),
  doc("memory-offsite", "projects/offsite.md", "Venue shortlist: two options downtown.", CHIEF.id),
];

const MANY_BOT_DOCS = [
  ...BOT_DOCS,
  doc("memory-hiring", "projects/hiring.md", "Two open roles on the design team.", CHIEF.id),
  doc("memory-vendors", "notes/vendors.md", "Renewals are due in January.", CHIEF.id),
  doc("memory-travel", "notes/travel.md", "Ada books aisle seats.", CHIEF.id),
  doc("memory-launch", "projects/launch.md", "Launch post goes out Tuesday morning.", CHIEF.id),
];

const SHARED_DOCS = [
  doc("shared-index", "MEMORY.md", "# Personal\n\n- Team timezone is Europe/Berlin.\n", null),
  doc("shared-glossary", "glossary.md", "ARR means annual recurring revenue.", null),
];

const NO_BUDGET: MemoryPromptBudget = {
  limitBytes: 32_768,
  usedBytes: 2_048,
  documents: [],
  omitted: [],
};

const OVER_BUDGET: MemoryPromptBudget = {
  limitBytes: 32_768,
  usedBytes: 32_768,
  documents: [
    {
      scope: "bot",
      path: "projects/q3-report.md",
      revision: 1,
      totalBytes: 12_288,
      includedBytes: 4_096,
      truncated: true,
    },
  ],
  omitted: [
    {
      scope: "bot",
      path: "projects/offsite.md",
      revision: 1,
      totalBytes: 6_144,
      includedBytes: 0,
      truncated: false,
    },
  ],
};

const SKILLS: AgentSkillCatalogEntry[] = [
  {
    id: "builtin:review",
    name: "Review a change",
    description: "Reads a proposed change and lists risks before it ships.",
    source: "builtin",
    readOnly: true,
  },
  {
    id: "skill-greeting",
    name: "greeting",
    description: "Greets new teammates and shares the onboarding checklist.",
    source: "user",
    readOnly: false,
    availability: { allSpaces: true, spaceIds: [SPACE_ID] },
  },
  {
    id: "skill-invoices",
    name: "invoice-filing",
    description: "Files monthly invoices into the finance folder.",
    source: "user",
    readOnly: false,
    availability: { allSpaces: false, spaceIds: [SPACE_ID] },
  },
];

const SPACES: SpaceNavigation = {
  current: {
    id: SPACE.id,
    name: SPACE.name,
    bots: BOTS,
    groups: [GROUP],
    externalConversations: [],
    botSections: [],
  },
  spaces: [SPACE, { ...SPACE, id: "space-2", name: "Work", isDefault: false, canDelete: true }],
};

const meta = {
  title: "Settings/Knowledge",
  component: KnowledgeSection,
  parameters: {
    layout: "padded",
    api: api({ memory: { list: BOT_DOCS, budget: NO_BUDGET } }),
  },
  args: { botId: CHIEF.id },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof KnowledgeSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Memory: Story = {};

export const ManyDocuments: Story = {
  parameters: { api: api({ memory: { list: MANY_BOT_DOCS } }) },
};

export const OverBudget: Story = {
  parameters: { api: api({ memory: { budget: OVER_BUDGET } }) },
};

export const EditingDocument: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "projects/q3-report.md" }));
  },
};

export const LoadFailed: Story = {
  parameters: {
    api: api({
      memory: {
        list: () => {
          throw new ORPCError("FORBIDDEN", { message: "Not allowed" });
        },
      },
    }),
  },
};

export const SharedMemory: Story = {
  render: () => <SpaceMemorySection />,
  parameters: { api: api({ memory: { list: SHARED_DOCS } }) },
};

export const SharedMemoryEmpty: Story = {
  render: () => <SpaceMemorySection />,
  parameters: { api: api({ memory: { list: [] } }) },
};

export const Skills: Story = {
  render: () => <AgentSkills />,
  parameters: { api: api({ agentSkills: { list: SKILLS }, spaces: { list: SPACES } }) },
};

export const SkillsEmpty: Story = {
  render: () => <AgentSkills />,
  parameters: { api: api({ agentSkills: { list: [] }, spaces: { list: SPACES } }) },
};

export const SkillsLoading: Story = {
  render: () => <AgentSkills />,
  parameters: {
    api: api({ agentSkills: { list: () => new Promise(() => {}) }, spaces: { list: SPACES } }),
  },
};
