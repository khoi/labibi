import type { IntegrationCatalogResult } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../../storybook/api";
import { IntegrationSetup } from "./IntegrationSetup";

const remote = (domain: string, name: string, description: string): IntegrationCatalogResult => ({
  domain,
  name,
  description,
  pageUrl: null,
  surfaces: [{ kind: "mcp", slug: domain, source: `https://mcp.${domain}/mcp`, auth: null }],
});

const RESULTS: IntegrationCatalogResult[] = [
  remote("notes.example.test", "Example Notes", "Pages, notes and wikis"),
  remote("tasks.example.test", "Example Tasks", "Projects and to-dos"),
  remote("calendar.example.test", "Example Calendar", "Events and invites"),
];

const meta = {
  title: "Integrations/Integration setup",
  component: IntegrationSetup,
  parameters: {
    layout: "padded",
    api: api({ capabilities: { catalogSearch: { enabled: true, results: RESULTS } } }),
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof IntegrationSetup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Results: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole("textbox", { name: "Search apps" }), "example{Enter}");
    await canvas.findByText("Example Notes");
  },
};

export const NoResults: Story = {
  parameters: { api: api({ capabilities: { catalogSearch: { enabled: true, results: [] } } }) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole("textbox", { name: "Search apps" }), "nothing{Enter}");
  },
};

export const SearchFailed: Story = {
  parameters: {
    api: api({
      capabilities: {
        catalogSearch: () => {
          throw new ORPCError("BAD_GATEWAY", { message: "The catalog did not answer" });
        },
      },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole("textbox", { name: "Search apps" }), "example{Enter}");
  },
};

export const DuringOnboarding: Story = {
  args: { onDone: fn(), botId: "bot-1" },
};
