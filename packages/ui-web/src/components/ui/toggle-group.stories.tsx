import type { Meta, StoryObj } from "@storybook/react-vite";
import { BoldIcon, ItalicIcon, ListIcon, UnderlineIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group.js";

const meta = {
  title: "Primitives/Toggle group",
  component: ToggleGroup,
  parameters: { layout: "centered" },
  args: { defaultValue: ["week"], "aria-label": "Range" },
  argTypes: {
    variant: { control: "inline-radio", options: ["default", "outline"] },
    size: { control: "inline-radio", options: ["sm", "default", "lg"] },
    spacing: { control: { type: "number", min: 0, max: 4 } },
    orientation: { control: "inline-radio", options: ["horizontal", "vertical"] },
    multiple: { control: "boolean" },
    disabled: { control: "boolean" },
  },
  render: (args) => (
    <ToggleGroup {...args}>
      <ToggleGroupItem value="day">Day</ToggleGroupItem>
      <ToggleGroupItem value="week">Week</ToggleGroupItem>
      <ToggleGroupItem value="month">Month</ToggleGroupItem>
    </ToggleGroup>
  ),
} satisfies Meta<typeof ToggleGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const OutlineJoined: Story = { args: { variant: "outline", spacing: 0 } };

export const Multiple: Story = {
  args: { multiple: true, defaultValue: ["bold", "list"], "aria-label": "Formatting" },
  render: (args) => (
    <ToggleGroup {...args}>
      <ToggleGroupItem value="bold" aria-label="Bold">
        <BoldIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="italic" aria-label="Italic">
        <ItalicIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="underline" aria-label="Underline">
        <UnderlineIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="list" aria-label="List">
        <ListIcon />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
};

export const Small: Story = { args: { size: "sm", variant: "outline" } };

export const Vertical: Story = {
  args: { orientation: "vertical", variant: "outline", spacing: 0 },
};

export const Disabled: Story = { args: { disabled: true } };
