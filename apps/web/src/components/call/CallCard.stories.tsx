import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, spyOn } from "storybook/test";
import {
  endCall,
  setCallMinimized,
  startCall,
  toggleMute,
  toggleTranscript,
} from "../../lib/call-session";
import { api } from "../../storybook/api";
import { CHIEF } from "../../storybook/fixtures";
import { CallCard, CallReturnBar } from "./CallCard";

class SilentRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult = null;
  onerror = null;
  onend = null;
  start() {}
  stop() {}
  abort() {}
}

function fakeCall({
  opening,
  transcript = false,
  muted = false,
  minimized = false,
}: {
  opening?: string;
  transcript?: boolean;
  muted?: boolean;
  minimized?: boolean;
}) {
  return () => {
    const microphone = spyOn(navigator.mediaDevices, "getUserMedia").mockImplementation(
      opening === undefined ? () => new Promise(() => {}) : async () => new MediaStream(),
    );
    const host = window as Window & { webkitSpeechRecognition?: unknown };
    const { AudioContext } = window;
    const recognition = host.webkitSpeechRecognition;
    Reflect.deleteProperty(window, "AudioContext");
    host.webkitSpeechRecognition = SilentRecognition;
    startCall({
      botId: CHIEF.id,
      botName: CHIEF.name,
      botColor: CHIEF.color,
      ...(opening === undefined ? {} : { answered: { callId: "call-story", opening } }),
    });
    if (transcript) toggleTranscript();
    if (muted) toggleMute();
    if (minimized) setCallMinimized(true);
    return () => {
      endCall();
      microphone.mockRestore();
      window.AudioContext = AudioContext;
      host.webkitSpeechRecognition = recognition;
    };
  };
}

const meta = {
  title: "Calls/Call card",
  component: CallCard,
  args: { onSettings: fn() },
  parameters: {
    route: "/app",
    api: api({
      threads: { endCall: { ok: true } },
      voice: { prepare: () => new Promise(() => {}) },
    }),
  },
} satisfies Meta<typeof CallCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Calling: Story = { beforeEach: fakeCall({}) };

export const Listening: Story = { beforeEach: fakeCall({ opening: "" }) };

export const Muted: Story = { beforeEach: fakeCall({ opening: "", muted: true }) };

export const WithTranscript: Story = {
  beforeEach: fakeCall({
    opening: "Hi Ada, the venue needs an answer about Tuesday. Does 2 pm still work?",
    transcript: true,
  }),
};

export const Phone: Story = {
  beforeEach: fakeCall({ opening: "" }),
  globals: { viewport: { value: "mobile1", isRotated: false } },
};

export const Minimized: Story = {
  beforeEach: fakeCall({ opening: "", minimized: true }),
  render: (args) => (
    <>
      <CallReturnBar />
      <CallCard {...args} />
    </>
  ),
};
