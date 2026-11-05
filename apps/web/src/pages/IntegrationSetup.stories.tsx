import type { IntegrationCatalogResult } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../storybook/api";
import { BOTS, CHIEF } from "../storybook/fixtures";
import { IntegrationSetupPage } from "./IntegrationSetup";

const result = (name: string, domain: string): IntegrationCatalogResult => ({
  domain,
  name,
  description: `${name} for your bots.`,
  pageUrl: null,
  surfaces: [{ kind: "mcp", slug: domain, source: `https://${domain}/mcp`, auth: null }],
});

const meta = {
  title: "Views/Integration setup",
  component: IntegrationSetupPage,
  parameters: {
    route: "/integrations/setup",
    api: api({
      bots: { list: [CHIEF] },
      capabilities: {
        catalogSearch: {
          enabled: true,
          results: [
            result("Example Notes", "notes.example.test"),
            result("Example Calendar", "calendar.example.test"),
          ],
        },
      },
    }),
  },
} satisfies Meta<typeof IntegrationSetupPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneBot: Story = {};

export const SeveralBots: Story = { parameters: { api: api({ bots: { list: BOTS } }) } };

export const SearchResults: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByRole("textbox", { name: "Search apps" }), "notes");
    await userEvent.click(canvas.getByRole("button", { name: "Search integrations.sh" }));
    await canvas.findByText("Example Notes");
  },
};

export const NoResults: Story = {
  parameters: { api: api({ capabilities: { catalogSearch: { enabled: true, results: [] } } }) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByRole("textbox", { name: "Search apps" }),
      "spreadsheets",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Search integrations.sh" }));
    await canvas.findByText("No remote MCP servers found");
  },
};

export const BotsFailed: Story = {
  parameters: {
    api: api({
      bots: {
        list: () => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "The server is busy." });
        },
      },
    }),
  },
};
