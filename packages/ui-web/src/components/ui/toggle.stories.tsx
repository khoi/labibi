import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArchiveIcon, PinIcon } from "lucide-react";
import { Toggle } from "./toggle.js";

const meta = {
  title: "Primitives/Toggle",
  component: Toggle,
  parameters: { layout: "centered" },
  args: { "aria-label": "Pin chat", children: <PinIcon /> },
  argTypes: {
    variant: { control: "inline-radio", options: ["default", "outline"] },
    size: { control: "inline-radio", options: ["sm", "default", "lg"] },
    pressed: { control: "boolean" },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Pressed: Story = { args: { defaultPressed: true } };

export const Outline: Story = { args: { variant: "outline" } };

export const WithText: Story = {
  args: {
    variant: "outline",
    "aria-label": undefined,
    children: (
      <>
        <ArchiveIcon data-icon="inline-start" />
        Show archived
      </>
    ),
  },
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      <Toggle {...args} size="sm" />
      <Toggle {...args} size="default" />
      <Toggle {...args} size="lg" />
    </div>
  ),
};

export const Disabled: Story = { args: { disabled: true } };
