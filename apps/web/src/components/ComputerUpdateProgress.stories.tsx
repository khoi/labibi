import type { ComputerUpdate } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../storybook/api";
import { CHIEF, SCOUT } from "../storybook/fixtures";
import { ComputerUpdateProgress } from "./ComputerUpdateProgress";

const UPDATING: ComputerUpdate = {
  action: "update",
  id: "update-1",
  botId: SCOUT.id,
  name: SCOUT.name,
  mode: "dedicated",
  status: "running",
  stage: "saving",
};

const RECOVERING: ComputerUpdate = {
  action: "recover",
  id: "update-2",
  botId: CHIEF.id,
  name: CHIEF.name,
  mode: "team",
  status: "running",
  stage: "recreating",
};

const meta = {
  title: "Computer/Update progress",
  component: ComputerUpdateProgress,
  parameters: { api: api({ computer: { updates: [UPDATING] } }) },
  args: { onCompleted: fn() },
  decorators: [
    (Story) => (
      <div className="min-h-screen">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ComputerUpdateProgress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Updating: Story = {};

export const Details: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Updating Scout/ }));
  },
};

export const Recovering: Story = {
  parameters: { api: api({ computer: { updates: [RECOVERING] } }) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Recovering Team Computer/ }));
  },
};

export const Failed: Story = {
  parameters: {
    api: api({
      computer: {
        updates: [{ ...UPDATING, status: "failed" }],
        recover: { ...RECOVERING, botId: SCOUT.id, name: SCOUT.name, mode: "dedicated" },
        dismissUpdate: { ok: true },
      },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Update failed/ }));
  },
};

export const Several: Story = {
  parameters: { api: api({ computer: { updates: [UPDATING, RECOVERING] } }) },
};
