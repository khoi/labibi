import { Button } from "@labradoodle/ui-web";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ErrorNotice } from "./ErrorNotice";

const meta = {
  title: "Primitives/Error notice",
  component: ErrorNotice,
  parameters: { layout: "centered" },
  args: {
    error: {
      message: "Couldn't reach Example AI. Check the connection and try again.",
      helpUrl: undefined,
    },
  },
} satisfies Meta<typeof ErrorNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Message: Story = {};

export const WithHelp: Story = {
  args: {
    error: {
      message: "The model rejected the key.",
      helpUrl: "https://docs.example.test/errors/model-key-rejected",
    },
  },
};

export const WithAction: Story = {
  args: {
    children: (
      <Button size="sm" variant="outline">
        Retry
      </Button>
    ),
  },
};
