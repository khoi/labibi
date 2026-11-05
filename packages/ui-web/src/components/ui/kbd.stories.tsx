import type { Meta, StoryObj } from "@storybook/react-vite";
import { CommandIcon } from "lucide-react";
import { Button } from "./button.js";
import { Kbd, KbdGroup } from "./kbd.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

const meta = {
  title: "Primitives/Kbd",
  component: Kbd,
  parameters: { layout: "centered" },
  args: { children: "⌘K" },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Group: Story = {
  render: (args) => (
    <KbdGroup>
      <Kbd {...args}>
        <CommandIcon />
      </Kbd>
      <Kbd {...args}>Shift</Kbd>
      <Kbd {...args}>P</Kbd>
    </KbdGroup>
  ),
};

export const InText: Story = {
  render: (args) => (
    <p className="text-sm text-muted-foreground">
      Press <Kbd {...args}>⌘ Enter</Kbd> to send, <Kbd {...args}>Esc</Kbd> to cancel.
    </p>
  ),
};

export const InTooltip: Story = {
  render: (args) => (
    <Tooltip defaultOpen>
      <TooltipTrigger render={<Button variant="outline" />}>New chat</TooltipTrigger>
      <TooltipContent>
        New chat <Kbd {...args}>⌘N</Kbd>
      </TooltipContent>
    </Tooltip>
  ),
};
