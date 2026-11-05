import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { CompatibleModelFields } from "./compatible-model-fields";

const BASE_URL = "http://127.0.0.1:8000/v1";
const FOUND = ["example-large", "example-small", "example-coder", "example-vision"];
const MANY = Array.from({ length: 14 }, (_, index) => `example-model-${index + 1}`);

const meta = {
  title: "Settings/Model settings/Compatible model fields",
  component: CompatibleModelFields,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
  args: {
    baseUrl: BASE_URL,
    effectiveBaseUrl: BASE_URL,
    apiProtocol: "chat-completions",
    busy: false,
    probing: false,
    compatibleRows: [],
    probeModels: [],
    defaultModelOptions: [],
    enabledModelIds: [],
    modelId: "",
    credential: undefined,
    headerRows: null,
    savedHeaderEndpointMatches: false,
    preflightFailure: null,
    preflightTarget: null,
    reasoning: false,
    thinkingLevel: null,
    maxTokens: "4096",
    contextWindow: "128000",
    supportsImages: false,
    maxImagesPerPrompt: "",
    selectionRevisionRef: { current: 0 },
    resetOpenAiCompatibleProbe: fn(),
    setHeaderRows: fn(),
    cancelOAuthAttempt: fn(),
    invalidatePreflight: fn(),
    probeServerModels: fn(async () => undefined),
    setContextWindow: fn(),
    setEnabledModelIds: fn(),
    setError: fn(),
    setMaxImagesPerPrompt: fn(),
    setMaxTokens: fn(),
    setNotice: fn(),
    setReasoning: fn(),
    setSupportsImages: fn(),
    setThinkingLevel: fn(),
    stageCompatibleModelId: fn(),
    updateApiProtocol: fn(),
    updateBaseUrl: fn(),
  },
} satisfies Meta<typeof CompatibleModelFields>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { args: { baseUrl: "", effectiveBaseUrl: "" } };

export const Probing: Story = { args: { probing: true } };

export const FoundModels: Story = {
  args: {
    compatibleRows: FOUND,
    probeModels: FOUND,
    modelId: "example-large",
    enabledModelIds: ["example-coder"],
    defaultModelOptions: ["example-coder", "example-large"],
  },
};

export const ManyModels: Story = {
  args: {
    compatibleRows: MANY,
    probeModels: MANY,
    modelId: "example-model-3",
    defaultModelOptions: ["example-model-3"],
  },
};

export const ThinkingAndHeaders: Story = {
  args: {
    compatibleRows: FOUND,
    modelId: "example-large",
    defaultModelOptions: ["example-large"],
    apiProtocol: "responses",
    reasoning: true,
    thinkingLevel: "high",
    supportsImages: true,
    maxImagesPerPrompt: "4",
    headerRows: [{ name: "X-Team", value: "research" }],
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByText("Advanced"));
  },
};

export const PreflightFailed: Story = {
  args: {
    modelId: "example-large",
    preflightTarget: "compatible",
    preflightFailure: {
      outcome: "unreachable",
      message: "Could not reach the server.",
      nextAction: "Check the server URL and that the server is running.",
    },
  },
};
