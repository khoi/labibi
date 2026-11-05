import type { Meta, StoryObj } from "@storybook/react-vite";
import { Textarea } from "./textarea.js";

const meta = {
  title: "Primitives/Textarea",
  component: Textarea,
  parameters: { layout: "centered" },
  args: {
    "aria-label": "Instructions",
    placeholder: "Tell Scout what to work on",
    className: "w-96",
  },
  argTypes: { disabled: { control: "boolean" } },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const LongValue: Story = {
  args: {
    defaultValue:
      "You research topics for the team.\n\nCite at least two sources for every claim and prefer primary sources. When sources disagree, say so and explain which one you trust more.\n\nKeep answers under 200 words unless someone asks for detail.",
  },
};

export const Invalid: Story = { args: { "aria-invalid": true, defaultValue: "" } };

export const Disabled: Story = {
  args: { disabled: true, defaultValue: "Summarize new messages in #research every morning." },
};
