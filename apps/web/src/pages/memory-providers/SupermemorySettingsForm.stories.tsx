import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { SupermemorySettingsForm } from "./SupermemorySettingsForm";

const meta = {
  title: "Settings/Memory providers/Supermemory",
  component: SupermemorySettingsForm,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  args: { busy: false, onConnect: fn(async () => true) },
} satisfies Meta<typeof SupermemorySettingsForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Cloud: Story = {};

export const SelfHosted: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Self-hosted" }));
    await userEvent.type(canvas.getByLabelText("Base URL"), "https://memory.example.test");
    await userEvent.type(canvas.getByLabelText("Instance API key"), "example-key-1234");
  },
};

export const Busy: Story = { args: { busy: true } };
