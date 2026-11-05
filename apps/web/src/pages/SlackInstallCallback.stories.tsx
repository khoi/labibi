import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../storybook/api";
import { SlackInstallCallbackPage } from "./SlackInstallCallback";

const meta = {
  title: "Views/Messaging install callback",
  component: SlackInstallCallbackPage,
  parameters: {
    route: "/messaging/slack/callback?state=story-state&code=story-code",
    api: api({ messaging: { installations: { complete: () => new Promise(() => {}) } } }),
  },
} satisfies Meta<typeof SlackInstallCallbackPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connecting: Story = {};

export const Failed: Story = {
  parameters: {
    api: api({
      messaging: {
        installations: {
          complete: () => {
            throw new ORPCError("BAD_REQUEST", { message: "The install link expired." });
          },
        },
      },
    }),
  },
};
