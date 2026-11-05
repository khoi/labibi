import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { SerenitySettingsForm } from "./SerenitySettingsForm";

const meta = {
  title: "Settings/Memory providers/Serenity",
  component: SerenitySettingsForm,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  args: { busy: false, onConnect: fn(async () => true) },
} satisfies Meta<typeof SerenitySettingsForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("MCP endpoint"), "https://memory.example.test/mcp");
    await userEvent.type(canvas.getByLabelText("Bearer token"), "example-token-1234");
    await userEvent.type(canvas.getByLabelText("Brain label"), "team notes");
    await userEvent.click(canvas.getByRole("button", { name: "Recall and write" }));
  },
};

export const MissingEndpoint: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText("Bearer token"), "example-token-1234");
    await userEvent.click(canvas.getByRole("button", { name: "Connect" }));
  },
};

export const Busy: Story = { args: { busy: true } };
