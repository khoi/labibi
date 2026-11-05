import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../storybook/api";
import { ME } from "../storybook/fixtures";
import { ComputersUnavailableHint } from "./ComputersUnavailableHint";

const meta = {
  title: "Computer/Computers unavailable",
  component: ComputersUnavailableHint,
  parameters: {
    layout: "padded",
    api: api({ health: { ok: true, version: "1.4.0" }, me: { ...ME, sandboxProvider: "none" } }),
  },
  args: {
    sandboxProvider: "none",
    onOpenComputerSettings: fn(),
    onRecovered: fn(),
    onRecoveryDismissed: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ComputersUnavailableHint>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ComputersOff: Story = {};

export const WithoutActions: Story = { args: { showRetry: false } };

export const Checking: Story = {
  parameters: { api: api({ health: () => new Promise(() => {}) }) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Check again" }));
  },
};

export const CheckFailed: Story = {
  parameters: {
    api: api({
      health: () => {
        throw new ORPCError("SERVICE_UNAVAILABLE", { message: "Server unavailable" });
      },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Check again" }));
  },
};

export const Recovered: Story = {
  parameters: { api: api({ me: { ...ME, sandboxProvider: "desktop" } }) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Check again" }));
  },
};
