import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../storybook/api";
import { CHIEF } from "../storybook/fixtures";
import { InstructionSettings } from "./InstructionSettings";

const instructions =
  "Keep plans short and concrete.\nCheck in with the team every Monday morning.\nAsk before sending anything outside the team.";

const withInstructions = { ...CHIEF, instructions };

const meta = {
  title: "Settings/Instructions",
  component: InstructionSettings,
  parameters: { layout: "padded" },
  args: { bot: withInstructions },
} satisfies Meta<typeof InstructionSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = { args: { bot: { ...CHIEF, instructions: "" } } };

export const WithHistory: Story = {
  args: {
    bot: {
      ...withInstructions,
      instructionHistory: [
        {
          id: "version-2",
          instructions: "Keep plans short.\nCheck in with the team every Monday morning.",
          reason: "Manual edit",
          createdAt: "2026-10-20T14:30:00.000Z",
        },
        {
          id: "version-1",
          instructions: "Keep plans short.",
          reason: "Created",
          createdAt: "2026-10-01T09:00:00.000Z",
        },
      ],
    },
  },
  parameters: {
    api: api({
      bots: { restoreInstructions: { ...withInstructions, instructions: "Keep plans short." } },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Instruction history" }));
  },
};

export const EditConflict: Story = {
  parameters: {
    api: api({
      bots: {
        update: () => {
          throw new ORPCError("CONFLICT", {
            message: "These instructions changed elsewhere. Reload to see the latest.",
          });
        },
        get: { ...withInstructions, instructions: `${instructions}\nShare a weekly summary.` },
      },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByRole("textbox"), " Always cite sources.");
    await userEvent.tab();
  },
};
