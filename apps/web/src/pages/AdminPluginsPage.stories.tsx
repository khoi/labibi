import type { PluginSubmission } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../storybook/api";
import { ME } from "../storybook/fixtures";
import { AdminPluginsPage } from "./AdminPluginsPage";

const submission: PluginSubmission = {
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

const meta = {
  title: "Views/Admin plugins",
  component: AdminPluginsPage,
  parameters: {
    route: "/admin/plugins",
    api: api({
      me: { ...ME, isAdmin: true },
      marketplace: {
        submissions: ({ status }) =>
          status === "pending"
            ? [
                submission,
                {
                  ...submission,
                  id: "submission-2",
                  email: "hello@tracker.example.test",
                  name: "Parcel tracker",
                  website: "https://tracker.example.test",
                  source: null,
                  description: "Follows deliveries and tells you when a parcel is late.",
                  testing: null,
                },
              ]
            : [],
      },
    }),
  },
} satisfies Meta<typeof AdminPluginsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Submissions: Story = {};

export const NoSubmissions: Story = {
  parameters: { api: api({ marketplace: { submissions: [] } }) },
};
