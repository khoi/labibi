import type { Meta, StoryObj } from "@storybook/react-vite";
import { Copy, Ellipsis, Smile } from "lucide-react";
import { MessageHoverMetadata } from "./MessageHoverMetadata";

const actions = (
  <div className="flex items-center gap-0.5 text-muted-foreground">
    <span className="px-1 text-xs tabular-nums">9:41</span>
    <button
      type="button"
      aria-label="React"
      className="grid size-7 place-items-center hover:text-foreground"
    >
      <Smile size={15} strokeWidth={1.7} />
    </button>
    <button
      type="button"
      aria-label="Copy"
      className="grid size-7 place-items-center hover:text-foreground"
    >
      <Copy size={15} strokeWidth={1.7} />
    </button>
    <button
      type="button"
      aria-label="More"
      className="grid size-7 place-items-center hover:text-foreground"
    >
      <Ellipsis size={15} strokeWidth={1.7} />
    </button>
  </div>
);

const meta = {
  title: "Primitives/Message hover metadata",
  component: MessageHoverMetadata,
  parameters: { layout: "centered" },
  args: { side: "end", pinned: true, children: actions },
  argTypes: { side: { control: "inline-radio", options: ["start", "end"] } },
  render: (args) => (
    <div className={`flex w-[36rem] ${args.side === "start" ? "justify-end" : "justify-start"}`}>
      <div className="group/message relative max-w-xs">
        <div
          className={
            args.side === "start"
              ? "rounded-2xl bg-primary px-4 py-2 text-[15px] text-primary-foreground"
              : "px-1 py-2 text-[15px] text-foreground"
          }
        >
          {args.side === "start" ? "Keep the summary short." : "Got it, one paragraph."}
        </div>
        <MessageHoverMetadata {...args} />
      </div>
    </div>
  ),
} satisfies Meta<typeof MessageHoverMetadata>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BotMessage: Story = {};

export const UserMessage: Story = { args: { side: "start" } };

export const RevealOnHover: Story = { args: { pinned: false } };
