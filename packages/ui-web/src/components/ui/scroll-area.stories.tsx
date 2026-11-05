import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScrollArea, ScrollBar } from "./scroll-area.js";
import { Separator } from "./separator.js";

const events = Array.from({ length: 24 }, (_, index) => ({
  id: index,
  time: `09:${String(59 - index * 2).padStart(2, "0")}`,
  text: ["Scout searched the web", "Ledger read 3 invoices", "Chief replied in #research"][
    index % 3
  ],
}));

const files = [
  "launch-plan.md",
  "q3-budget.csv",
  "interview-notes.txt",
  "pricing-draft.md",
  "survey-results.csv",
  "standup-2026-11-04.md",
  "roadmap.png",
];

const meta = {
  title: "Primitives/Scroll area",
  component: ScrollArea,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Vertical: Story = {
  args: { className: "h-72 w-72 rounded-lg border" },
  render: (args) => (
    <ScrollArea {...args}>
      <div className="p-4">
        <h4 className="mb-4 text-sm font-medium">Activity</h4>
        {events.map((event) => (
          <div key={event.id}>
            <div className="flex gap-3 text-sm">
              <span className="text-muted-foreground tabular-nums">{event.time}</span>
              <span>{event.text}</span>
            </div>
            <Separator className="my-2" />
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};

export const Horizontal: Story = {
  args: { className: "w-96 rounded-lg border whitespace-nowrap" },
  render: (args) => (
    <ScrollArea {...args}>
      <div className="flex w-max gap-3 p-4">
        {files.map((file) => (
          <div
            key={file}
            className="flex h-20 w-40 shrink-0 items-end rounded-lg bg-muted p-3 text-sm"
          >
            {file}
          </div>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  ),
};
