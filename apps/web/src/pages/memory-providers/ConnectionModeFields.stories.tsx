import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ConnectionModeFields } from "./ConnectionModeFields";

const meta = {
  title: "Settings/Memory providers/Connection mode fields",
  component: ConnectionModeFields,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  args: {
    busy: false,
    mode: "cloud",
    baseUrl: "",
    onModeChange: fn(),
    onBaseUrlChange: fn(),
  },
} satisfies Meta<typeof ConnectionModeFields>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Cloud: Story = {};

export const SelfHosted: Story = {
  args: { mode: "local", baseUrl: "https://memory.example.test" },
};

export const SelfHostedEmpty: Story = { args: { mode: "local" } };

export const Busy: Story = {
  args: { mode: "local", baseUrl: "https://memory.example.test", busy: true },
};
