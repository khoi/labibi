import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlusIcon } from "lucide-react";
import { Button } from "./button.js";

const variants = [
  "default",
  "outline",
  "secondary",
  "ghost",
  "destructive",
  "link",
  "text",
  "floating",
] as const;
const sizes = ["xs", "sm", "default", "lg", "xl"] as const;

const meta = {
  title: "Primitives/Button",
  component: Button,
  parameters: { layout: "centered" },
  args: { children: "Save changes" },
  argTypes: {
    variant: { control: "select", options: variants },
    size: {
      control: "select",
      options: [...sizes, "icon", "icon-xs", "icon-sm", "icon-lg"],
    },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {variants.map((variant) => (
        <Button key={variant} {...args} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {sizes.map((size) => (
        <Button key={size} {...args} size={size}>
          {size}
        </Button>
      ))}
      <Button {...args} size="icon" aria-label="Add">
        <PlusIcon />
      </Button>
    </div>
  ),
};

export const Disabled: Story = { args: { disabled: true } };
