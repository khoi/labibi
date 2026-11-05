import type { ChatModelChoice } from "@labradoodle/core";
import type { Meta, StoryContext, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ChatModelPicker } from "./chat-model-picker";

const model = (
  provider: string,
  providerLabel: string,
  modelId: string,
  modelLabel: string,
  images = true,
): ChatModelChoice => ({
  key: `${provider}::${modelId}`,
  label: `${modelLabel} (${providerLabel})`,
  provider,
  providerLabel,
  modelId,
  modelLabel,
  images,
});

const SHORT: ChatModelChoice[] = [
  { key: "", label: "Space default (Example Large)", images: true },
  model("example", "Example AI", "example-large", "Example Large"),
  model("example", "Example AI", "example-small", "Example Small"),
  model("local", "Local models", "local-text-7b", "Local Text 7B", false),
];

const LONG: ChatModelChoice[] = [
  ...SHORT,
  model("example", "Example AI", "example-reasoning", "Example Reasoning"),
  model("example", "Example AI", "example-vision", "Example Vision"),
  model("example", "Example AI", "example-mini", "Example Mini"),
  model("router", "Example Router", "alpha/writer-large", "Alpha: Writer Large"),
  model("router", "Example Router", "alpha/writer-small", "Alpha: Writer Small"),
  model("router", "Example Router", "beta/coder", "Beta: Coder"),
  model("router", "Example Router", "beta/coder-mini", "Beta: Coder Mini", false),
  model("local", "Local models", "local-code-13b", "Local Code 13B", false),
];

const open = async ({ canvas, userEvent }: StoryContext) => {
  await userEvent.click(canvas.getByRole("button", { name: /Example Large/ }));
};

const meta = {
  title: "Chat/Chat model picker",
  component: ChatModelPicker,
  parameters: { layout: "padded" },
  args: { id: "chat-model", choices: SHORT, value: "", onChange: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-xs">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatModelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ShortList: Story = {};

export const TextOnlyModel: Story = { args: { value: "local::local-text-7b" } };

export const SearchableList: Story = {
  args: { choices: LONG, value: "example::example-large" },
  play: open,
};

export const Searching: Story = {
  args: { choices: LONG, value: "example::example-large" },
  play: async (context) => {
    await open(context);
    await context.userEvent.keyboard("coder");
  },
};
