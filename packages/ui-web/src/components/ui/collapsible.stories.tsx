import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronsUpDownIcon } from "lucide-react";
import { Button } from "./button.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible.js";

const tools = ["Search the web", "Read pages", "Run code", "Create images", "Send email"];

const meta = {
  title: "Primitives/Collapsible",
  component: Collapsible,
  parameters: { layout: "padded" },
  args: { defaultOpen: true },
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  render: (args) => (
    <Collapsible {...args} className="flex w-80 flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium">Scout can use 5 tools</span>
        <CollapsibleTrigger render={<Button variant="ghost" size="icon-sm" />}>
          <ChevronsUpDownIcon />
          <span className="sr-only">Show tools</span>
        </CollapsibleTrigger>
      </div>
      <div className="rounded-lg border px-3 py-2 text-sm">{tools[0]}</div>
      <CollapsibleContent className="flex flex-col gap-2">
        {tools.slice(1).map((tool) => (
          <div key={tool} className="rounded-lg border px-3 py-2 text-sm">
            {tool}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  ),
};

export const Closed: Story = { ...Open, args: { defaultOpen: false } };

export const Disabled: Story = { ...Open, args: { defaultOpen: false, disabled: true } };
