import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../../storybook/api";
import { SCOUT } from "../../storybook/fixtures";
import { IncomingCall } from "./IncomingCall";

const caller = {
  ...SCOUT,
  incomingCall: {
    callId: "call-1",
    reason: "The venue needs an answer about Tuesday before 5 pm today.",
    opening: "Hi Ada, quick question about the venue.",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
};

const meta = {
  title: "Calls/Incoming call",
  component: IncomingCall,
  args: { bots: [caller], onAnswered: fn() },
  parameters: {
    api: api({ notifications: { declineIncomingCall: { ok: true } } }),
  },
  beforeEach: () => {
    const { AudioContext } = window;
    Reflect.deleteProperty(window, "AudioContext");
    return () => {
      window.AudioContext = AudioContext;
    };
  },
} satisfies Meta<typeof IncomingCall>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ringing: Story = {};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};

export const AnswerFailed: Story = {
  parameters: {
    api: api({
      threads: {
        answerCall: () => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", {
            message: "Could not connect the call. Try again.",
          });
        },
      },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Answer" }));
  },
};
