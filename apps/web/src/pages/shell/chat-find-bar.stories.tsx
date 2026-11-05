import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import { fn } from "storybook/test";
import { ChatFindBar } from "./chat-find-bar";

const MESSAGES = [
  { id: "message-1", role: "user", text: "Can you get the Q3 report ready for Monday?" },
  {
    id: "message-2",
    role: "bot",
    text: "Sure. I'll pull revenue and churn from the finance sheet, draft the summary, and send it to you for review.",
  },
  { id: "message-3", role: "user", text: "Keep the summary short." },
  {
    id: "message-4",
    role: "bot",
    text: "Got it, one paragraph. The summary will be ready Monday.",
  },
];

function FindInChat({ onClose }: { onClose: () => void }) {
  const scope = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div ref={scope} className="relative flex h-dvh flex-col bg-background">
      <div
        data-testid="transcript"
        className="flex flex-1 flex-col gap-2 overflow-y-auto px-6 pt-20 text-body1"
      >
        {MESSAGES.map((message) => (
          <div
            key={message.id}
            data-message-id={message.id}
            className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <p
              className={
                message.role === "user"
                  ? "max-w-md rounded-[20px] bg-chat-user px-[18px] py-3 text-chat-user-foreground"
                  : "max-w-md rounded-[20px] bg-muted px-[18px] py-3 text-foreground"
              }
            >
              {message.text}
            </p>
          </div>
        ))}
      </div>
      <div className="absolute end-3 top-14 z-20">
        <ChatFindBar scope={scope} inputRef={inputRef} onClose={onClose} />
      </div>
    </div>
  );
}

const search =
  (query: string) =>
  async ({ canvas, userEvent }: StoryContext) => {
    await userEvent.type(canvas.getByRole("searchbox", { name: "Find in chat" }), query);
  };

const meta = {
  title: "Chat/Chat find bar",
  component: FindInChat,
  args: { onClose: fn() },
} satisfies Meta<typeof FindInChat>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};

export const Matches: Story = { play: search("summary") };

export const NoMatches: Story = { play: search("invoice") };
