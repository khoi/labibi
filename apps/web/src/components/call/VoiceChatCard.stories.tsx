import type { MessageBlock } from "@labradoodle/contracts";
import type { VoiceChatGroup, VoiceChatMessage } from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { VoiceChatCard } from "./VoiceChatCard";

const turn = (id: string, role: "user" | "bot", text: string): VoiceChatMessage => ({
  id,
  role,
  callId: "call-3",
  blocks: [{ kind: "text", text }],
});

const marker: VoiceChatMessage = {
  id: "marker-3",
  role: "bot",
  callId: "call-3",
  blocks: [
    {
      kind: "voice_call",
      callId: "call-3",
      title: "Offsite planning",
      farewell: "Talk soon.",
      durationSeconds: 184,
    },
  ],
};

const phoneCall: VoiceChatGroup = {
  kind: "voiceChat",
  key: "call:call-3",
  callId: "call-3",
  messages: [
    turn("turn-1", "user", "Can we go over the offsite?"),
    turn("turn-2", "bot", "Sure. The Loft is booked for Tuesday, and lunch is ordered for twelve."),
    turn("turn-3", "user", "Great, add a projector too."),
    turn("turn-4", "bot", "Done. I asked the venue for a projector and a spare cable."),
    marker,
  ],
  marker,
};

function requestGroup(request: Extract<MessageBlock, { kind: "call_request" }>): VoiceChatGroup {
  const answered = request.status === "answered";
  return {
    kind: "voiceChat",
    key: `call:${request.callId}`,
    callId: request.callId,
    messages: [
      { id: `${request.callId}-request`, role: "bot", callId: request.callId, blocks: [request] },
      ...(answered
        ? [
            turn(`${request.callId}-1`, "user", "Yes, Tuesday works."),
            turn(`${request.callId}-2`, "bot", "Perfect, I'll confirm The Loft for Tuesday."),
          ]
        : []),
    ],
  };
}

const venueCall = {
  kind: "call_request",
  callId: "call-1",
  reason: "The venue needs an answer today",
  opening: "Hi Ada, quick question about the venue.",
  expiresAt: "2099-01-01T00:00:00.000Z",
} as const;

const meta = {
  title: "Calls/Voice chat card",
  component: VoiceChatCard,
  parameters: { layout: "padded" },
  args: { group: phoneCall, onCallBack: fn() },
} satisfies Meta<typeof VoiceChatCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PhoneCall: Story = {};

export const Transcript: Story = { args: { revealMessageId: "turn-2" } };

export const Ringing: Story = {
  args: { group: requestGroup({ ...venueCall, status: "ringing" }) },
};

export const IncomingAnswered: Story = {
  args: { group: requestGroup({ ...venueCall, status: "answered", durationSeconds: 47 }) },
};

export const Missed: Story = {
  args: {
    group: requestGroup({ ...venueCall, status: "missed", expiresAt: "2026-10-26T09:30:00.000Z" }),
  },
};

export const Declined: Story = {
  args: { group: requestGroup({ ...venueCall, status: "declined" }) },
};
