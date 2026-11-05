import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { useState } from "react";
import { ModelThinkingOptions } from "./model-thinking-options.js";

type Props = ComponentProps<typeof ModelThinkingOptions>;

function Stateful(props: Props) {
  const [reasoning, setReasoning] = useState(props.reasoning ?? false);
  const [thinkingLevel, setThinkingLevel] = useState(props.thinkingLevel ?? null);
  const [maxTokens, setMaxTokens] = useState(props.maxTokens ?? "");
  const [contextWindow, setContextWindow] = useState(props.contextWindow ?? "");
  const [supportsImages, setSupportsImages] = useState(props.supportsImages ?? false);
  const [maxImagesPerPrompt, setMaxImagesPerPrompt] = useState(props.maxImagesPerPrompt ?? "");
  return (
    <ModelThinkingOptions
      {...props}
      reasoning={reasoning}
      onReasoningChange={(value) => {
        setReasoning(value);
        if (!value) setThinkingLevel(null);
      }}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={setThinkingLevel}
      maxTokens={maxTokens}
      onMaxTokensChange={setMaxTokens}
      contextWindow={contextWindow}
      onContextWindowChange={setContextWindow}
      supportsImages={supportsImages}
      onSupportsImagesChange={setSupportsImages}
      maxImagesPerPrompt={maxImagesPerPrompt}
      onMaxImagesPerPromptChange={setMaxImagesPerPrompt}
    />
  );
}

const narrow: Decorator = (Story) => (
  <div className="w-96">
    <Story />
  </div>
);

function open({ canvasElement }: { canvasElement: HTMLElement }) {
  canvasElement.querySelector("button")?.click();
}

const meta = {
  title: "Primitives/Model thinking options",
  component: ModelThinkingOptions,
  parameters: { layout: "centered" },
  args: {
    advancedLabel: "Advanced",
    thinkingLabel: "Supports thinking",
    thinkingLevelLabel: "Reasoning effort",
    thinkingLevelDefaultLabel: "Default",
    thinkingLevelOptions: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
    maxTokensLabel: "Maximum output tokens",
    contextWindowLabel: "Context limit",
    imagesLabel: "Supports images",
    maxImagesLabel: "Maximum images per request",
  },
  decorators: [narrow],
  render: (args) => <Stateful {...args} />,
  play: open,
} satisfies Meta<typeof ModelThinkingOptions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Thinking: Story = { args: { reasoning: true, thinkingLevel: "high" } };

export const Limits: Story = {
  args: {
    maxTokens: "32768",
    contextWindow: "200000",
    supportsImages: true,
    maxImagesPerPrompt: "8",
  },
};

export const WithoutThinking: Story = { args: { showThinking: false } };

export const Disabled: Story = {
  args: { disabled: true, reasoning: true, thinkingLevel: "medium", maxTokens: "8192" },
};

export const Collapsed: Story = { play: () => {} };
