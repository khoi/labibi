import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../storybook/api";
import { TrustedLinkSitesSettings } from "./TrustedLinkSitesSettings";

const meta = {
  title: "Settings/Trusted link sites",
  component: TrustedLinkSitesSettings,
  parameters: {
    layout: "padded",
    api: api({
      trustedLinkSites: {
        list: ["docs.example.test", "status.example.test"],
        remove: { ok: true },
      },
    }),
  },
} satisfies Meta<typeof TrustedLinkSitesSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};

export const LongNames: Story = {
  parameters: {
    api: api({
      trustedLinkSites: {
        list: [
          "a-very-long-subdomain-name-for-internal-reports.eu-central.example.test",
          "docs.example.test",
          "wiki.team.example.test",
        ],
      },
    }),
  },
};

export const RemoveFails: Story = {
  parameters: {
    api: api({
      trustedLinkSites: {
        remove: () => {
          throw new ORPCError("BAD_REQUEST", { message: "Could not remove this site" });
        },
      },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Remove docs.example.test" }));
  },
};
