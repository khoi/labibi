import type { PluginSubmission } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../storybook/api";
import { PluginSubmissionsPanel } from "./PluginSubmissionsPanel";

const notes: PluginSubmission = {
  id: "submission-1",
  email: "maker@example.test",
  name: "Notes",
  website: "https://notes.example.test",
  logo: null,
  source: "https://code.example.test/notes",
  description: "Turns a day's meetings into a short plan with the three things that matter most.",
  testing: "Ask it to plan tomorrow, then check the plan lists every meeting on the calendar.",
  claim: null,
  status: "pending",
  reason: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  reviewedAt: null,
};

const tracker: PluginSubmission = {
  ...notes,
  id: "submission-2",
  email: "hello@tracker.example.test",
  name: "Parcel tracker",
  website: "https://tracker.example.test",
  source: null,
  description: "Follows deliveries and tells you when a parcel is late.",
  testing: null,
};

const claim: PluginSubmission = {
  ...notes,
  id: "submission-3",
  email: "owner@expenses.example.test",
  name: "Expense board",
  website: "https://expenses.example.test",
  source: null,
  description: "",
  testing: null,
  claim: "expense-board",
};

const all = [
  notes,
  tracker,
  claim,
  {
    ...tracker,
    id: "submission-4",
    name: "Recipe box",
    email: "chef@recipes.example.test",
    website: "https://recipes.example.test",
    description: "Saves recipes from links and builds a weekly shopping list.",
    status: "rejected" as const,
    reason: "The website does not describe what data the plugin reads.",
    reviewedAt: "2026-10-03T00:00:00.000Z",
  },
];

const meta = {
  title: "Settings/Plugin submissions",
  component: PluginSubmissionsPanel,
  parameters: {
    layout: "padded",
    api: api({
      marketplace: {
        submissions: (input) => all.filter((submission) => submission.status === input.status),
      },
    }),
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PluginSubmissionsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {};

export const Rejected: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("tab", { name: "Rejected" }));
  },
};

export const RejectDialog: Story = {
  play: async ({ canvas, userEvent }) => {
    const [reject] = await canvas.findAllByRole("button", { name: "Reject" });
    await userEvent.click(reject!);
  },
};

export const Empty: Story = {
  parameters: { api: api({ marketplace: { submissions: [] } }) },
};

export const Loading: Story = {
  parameters: { api: api({ marketplace: { submissions: () => new Promise(() => {}) } }) },
};

export const LoadError: Story = {
  parameters: {
    api: api({
      marketplace: {
        submissions: () => {
          throw new ORPCError("FORBIDDEN", { message: "Only reviewers can see submissions" });
        },
      },
    }),
  },
};
