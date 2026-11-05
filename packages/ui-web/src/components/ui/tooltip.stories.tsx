import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArchiveIcon, PencilIcon } from "lucide-react";
import { Button } from "./button.js";
import { Kbd } from "./kbd.js";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip.js";

const sides = ["top", "right", "bottom", "left"] as const;

const meta = {
  title: "Primitives/Tooltip",
  component: Tooltip,
  parameters: { layout: "centered" },
  args: { defaultOpen: true },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Tooltip {...args}>
      <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="Archive chat" />}>
        <ArchiveIcon />
      </TooltipTrigger>
      <TooltipContent>Archive chat</TooltipContent>
    </Tooltip>
  ),
};

export const WithShortcut: Story = {
  render: (args) => (
    <Tooltip {...args}>
      <TooltipTrigger render={<Button variant="outline" size="icon" aria-label="New chat" />}>
        <PencilIcon />
      </TooltipTrigger>
      <TooltipContent>
        New chat <Kbd>⌘N</Kbd>
      </TooltipContent>
    </Tooltip>
  ),
};

export const Sides: Story = {
  render: (args) => (
    <div className="grid grid-cols-2 gap-x-32 gap-y-16 p-16">
      {sides.map((side) => (
        <TooltipProvider key={side}>
          <Tooltip {...args}>
            <TooltipTrigger render={<Button variant="outline" />}>{side}</TooltipTrigger>
            <TooltipContent side={side}>Shown on the {side}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  ),
};

export const LongText: Story = {
  render: (args) => (
    <Tooltip {...args}>
      <TooltipTrigger render={<Button variant="outline" />}>example-large</TooltipTrigger>
      <TooltipContent>
        Best for long research tasks. Slower and costs more per message than example-small.
      </TooltipContent>
    </Tooltip>
  ),
};

export const Closed: Story = { ...Default, args: { defaultOpen: false } };
