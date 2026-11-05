import type { ComputerStatus } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, screen } from "storybook/test";
import { api } from "../storybook/api";
import { CHIEF } from "../storybook/fixtures";
import { ComputerMaintenanceActions } from "./ComputerMaintenanceActions";

const RUNNING: ComputerStatus = {
  botId: CHIEF.id,
  mode: "team",
  kind: "desktop",
  state: "running",
  controlHolder: "none",
  controlBotId: null,
  takeoverRequested: false,
  screenAvailable: true,
  screenWidth: 1280,
  screenHeight: 800,
  homeRevision: null,
  busyBotName: null,
  canUpdate: true,
  terminalAvailable: true,
};

const meta = {
  title: "Computer/Maintenance actions",
  component: ComputerMaintenanceActions,
  parameters: { layout: "centered" },
  args: { botId: CHIEF.id, computer: RUNNING, onChanged: fn(async () => undefined) },
  decorators: [
    (Story) => (
      <div className="flex h-[420px] w-80 items-start justify-end">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ComputerMaintenanceActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "More computer actions" }));
  },
};

export const StoppedWithoutUpdates: Story = {
  args: { computer: { ...RUNNING, state: "stopped", canUpdate: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "More computer actions" }));
  },
};

export const BusyWithAnotherBot: Story = {
  args: { computer: { ...RUNNING, busyBotName: "Scout" } },
};

export const ConfirmReset: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "More computer actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Reset computer" }));
  },
};

export const StopFailed: Story = {
  parameters: {
    api: api({
      computer: {
        stop: () => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "The computer did not stop" });
        },
      },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "More computer actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Stop computer" }));
  },
};

export const RecoverButton: Story = {
  args: { computer: { ...RUNNING, state: "error" }, visibleRecover: true },
};
