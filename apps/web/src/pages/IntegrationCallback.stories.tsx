import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { IntegrationCallbackPage } from "./IntegrationCallback";

const meta = {
  title: "Views/Integration callback",
  component: IntegrationCallbackPage,
  parameters: { route: "/integrations/callback" },
  beforeEach: () => {
    const close = window.close;
    window.close = fn().mockName("window.close");
    return () => {
      window.close = close;
    };
  },
} satisfies Meta<typeof IntegrationCallbackPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
