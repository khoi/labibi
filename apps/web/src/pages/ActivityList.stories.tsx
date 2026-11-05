import type { RunActivityRow } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { emptyActivityFilters } from "../lib/activity-list-filters";
import { api } from "../storybook/api";
import { BOTS, CHIEF, GROUP, LEDGER, SCOUT } from "../storybook/fixtures";
import { ActivityList } from "./ActivityList";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function run(
  overrides: Partial<RunActivityRow> & Pick<RunActivityRow, "runId" | "status">,
): RunActivityRow {
  return {
    botId: CHIEF.id,
    botName: CHIEF.name,
    groupId: null,
    groupName: null,
    threadId: CHIEF.threadId,
    trigger: "user",
    notificationsEnabled: true,
    promptSnippet: "Get the Q3 report ready for Monday",
    agentMessage: null,
    updatedAt: minutesAgo(2),
    ...overrides,
  };
}

const ACTIVE: RunActivityRow[] = [
  run({
    runId: "run-1",
    status: "waiting_input",
    promptSnippet: "Which quarter should the summary cover?",
  }),
  run({
    runId: "run-2",
    status: "running",
    botId: LEDGER.id,
    botName: LEDGER.name,
    threadId: LEDGER.threadId,
    promptSnippet: "File the October invoices",
  }),
];

const RECENT: RunActivityRow[] = [
  run({
    runId: "run-3",
    status: "completed",
    botId: SCOUT.id,
    botName: SCOUT.name,
    groupId: GROUP.id,
    groupName: GROUP.name,
    threadId: GROUP.threadId,
    trigger: "bot_message",
    agentMessage: { kind: "request", fromBotName: CHIEF.name, text: "Draft the launch post" },
    updatedAt: minutesAgo(25),
  }),
  run({
    runId: "run-4",
    status: "failed",
    botId: LEDGER.id,
    botName: LEDGER.name,
    threadId: LEDGER.threadId,
    trigger: "routine",
    promptSnippet: "Weekly spend summary",
    updatedAt: minutesAgo(90),
  }),
  run({
    runId: "run-5",
    status: "cancelled",
    promptSnippet: "Book a room for the retro",
    updatedAt: minutesAgo(60 * 26),
  }),
];

const meta = {
  title: "Panels/Activity list",
  component: ActivityList,
  parameters: {
    layout: "padded",
    api: api({
      runs: { list: ({ filter }) => ({ runs: filter === "active" ? ACTIVE : RECENT }) },
    }),
  },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
  args: {
    bots: BOTS,
    groups: [{ ...GROUP, unread: true }],
    toggledSections: new Set(["activity:working", "activity:unread"]),
    filters: emptyActivityFilters(),
    filtersExpanded: false,
    filtersId: "activity-filters",
    onToggleSection: fn(),
    onOpenRun: fn(),
    onOpenBot: fn(),
    onOpenGroup: fn(),
    onFiltersChange: fn(),
  },
} satisfies Meta<typeof ActivityList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Collapsed: Story = { args: { toggledSections: new Set() } };

export const FiltersOpen: Story = {
  args: {
    filtersExpanded: true,
    filters: { query: "", status: "failed", dateRange: { from: "", to: "" } },
  },
};

export const NoMatches: Story = {
  args: {
    filtersExpanded: true,
    filters: { query: "", status: "waiting_takeover", dateRange: { from: "", to: "" } },
  },
};

export const Loading: Story = {
  parameters: { api: api({ runs: { list: () => new Promise(() => {}) } }) },
};

export const LoadError: Story = {
  parameters: {
    api: api({
      runs: {
        list: () => {
          throw new ORPCError("FORBIDDEN", { message: "Could not load activity" });
        },
      },
    }),
  },
};
