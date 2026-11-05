import type { Meta, StoryObj } from "@storybook/react-vite";
import { ModelPreflightFeedback } from "./ModelConnectionPreflightNotice";

const meta = {
  title: "Chat/Model connection preflight",
  component: ModelPreflightFeedback,
  parameters: { layout: "padded" },
  args: { success: null, failure: null },
} satisfies Meta<typeof ModelPreflightFeedback>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connected: Story = {
  args: { success: "Connected to example-large" },
};

export const Unauthorized: Story = {
  args: {
    failure: {
      outcome: "unauthorized",
      message: "Example AI rejected this API key.",
      nextAction: "Check the key and paste it again.",
    },
  },
};

export const RateLimited: Story = {
  args: {
    failure: {
      outcome: "rate_limit",
      message: "Example AI is limiting requests from this key.",
      nextAction: "Wait a minute, then test again.",
    },
  },
};
