import type {
  VoiceCatalogEntry,
  VoiceCredential,
  VoiceInfo,
  VoiceStatus,
} from "@labradoodle/contracts";
import { OPENAI_COMPATIBLE_PROVIDER_ID } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../storybook/api";
import { VoiceSettingsOverlay } from "./VoiceSettingsOverlay";

const CATALOG: VoiceCatalogEntry[] = [
  {
    id: "example-voice",
    name: "Example Voice",
    description: "Hosted speech and transcription.",
    transcribe: true,
  },
  {
    id: "sample-speech",
    name: "Sample Speech",
    description: "Hosted speech.",
    transcribe: false,
  },
  {
    id: OPENAI_COMPATIBLE_PROVIDER_ID,
    name: "Self-hosted",
    description: "A speech server you run.",
    transcribe: true,
  },
];

const VOICES: VoiceInfo[] = [
  { id: "voice-calm", label: "Calm", description: "Warm and steady" },
  { id: "voice-bright", label: "Bright", description: "Quick and upbeat" },
  { id: "voice-low", label: "Low" },
];

const CONNECTED: VoiceCredential = {
  id: "voice-cred-1",
  provider: "example-voice",
  hasKey: true,
  isDefault: true,
  voiceId: "voice-calm",
  speechModel: "",
  transcribe: true,
  endpoint: "",
  ttsModel: "",
  sttModel: "",
};

const SELF_HOSTED: VoiceCredential = {
  ...CONNECTED,
  id: "voice-cred-2",
  provider: OPENAI_COMPATIBLE_PROVIDER_ID,
  hasKey: false,
  voiceId: "voice-bright",
  endpoint: "http://127.0.0.1:8880/v1",
  ttsModel: "example-tts",
  sttModel: "example-stt",
};

const OFF: VoiceStatus = {
  configured: false,
  ready: false,
  transcribe: false,
  provider: null,
  voiceId: "",
};

function voiceApi(credentials: VoiceCredential[]) {
  const active = credentials[0];
  return api({
    voice: {
      catalog: CATALOG,
      credentials,
      status: active
        ? {
            configured: true,
            ready: true,
            transcribe: active.transcribe,
            provider: active.provider,
            voiceId: active.voiceId,
          }
        : OFF,
      voices: VOICES,
      setVoice: (input) => ({ ...OFF, configured: true, ready: true, voiceId: input.voiceId }),
    },
  });
}

const meta = {
  title: "Settings/Voice",
  component: VoiceSettingsOverlay,
  parameters: { api: voiceApi([]) },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background">
        <Story />
      </div>
    ),
  ],
  args: { scope: "account", onClose: fn(), onBusyChange: fn() },
} satisfies Meta<typeof VoiceSettingsOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotConnected: Story = {};

export const Connected: Story = { parameters: { api: voiceApi([CONNECTED]) } };

export const SelfHosted: Story = { parameters: { api: voiceApi([SELF_HOSTED]) } };

export const SpaceScope: Story = {
  args: { scope: "space" },
  parameters: { api: voiceApi([CONNECTED]) },
};

export const Loading: Story = {
  parameters: { api: api({ voice: { catalog: () => new Promise(() => {}) } }) },
};

export const LoadFailed: Story = {
  parameters: {
    api: api({
      voice: {
        catalog: () => {
          throw new ORPCError("BAD_REQUEST", { message: "Voice is unavailable right now." });
        },
      },
    }),
  },
};
