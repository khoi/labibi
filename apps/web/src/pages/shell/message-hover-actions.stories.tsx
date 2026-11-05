import { cn } from "@labradoodle/ui-web";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { say } from "../../storybook/fixtures";
import { previewMessageText } from "./chat-shared";
import { MessageHoverActions } from "./message-hover-actions";

const meta = {
  title: "Chat/Message hover actions",
  component: MessageHoverActions,
  parameters: { layout: "padded" },
  args: {
    message: say("bot", "The draft is ready for review."),
    side: "end",
    onReply: fn(),
    onMarkUnread: fn(),
    onReact: fn(async () => {}),
  },
  decorators: [
    (Story, { args }) => (
      <div
        className={cn(
          "group/message flex px-24 pt-4 pb-56",
          args.side === "start" ? "justify-end" : "justify-start",
        )}
      >
        <div className="relative w-fit">
          <div className="rounded-[20px] bg-muted px-[18px] py-3 text-body1 text-foreground">
            {previewMessageText(args.message)}
          </div>
          <Story />
        </div>
      </div>
    ),
  ],
  play: async ({ canvas }) => {
    canvas.getByRole("button", { name: "Reply" }).focus();
  },
} satisfies Meta<typeof MessageHoverActions>;

export default meta;
type Story = StoryObj<typeof meta>;

const open =
  (name: string) =>
  async ({ canvas, userEvent }: StoryContext) => {
    const trigger = canvas.getByRole("button", { name });
    trigger.focus();
    await userEvent.click(trigger);
  };

export const BotMessage: Story = {};

export const UserMessage: Story = {
  args: { message: say("user", "Keep the summary short."), side: "start" },
};

export const MoreMenu: Story = { play: open("More") };

export const MarkedUnread: Story = {
  args: { markedUnread: true },
  play: open("More"),
};

export const Reactions: Story = { play: open("React") };
