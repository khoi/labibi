import type { ComputerStatus, TaughtSkill } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, waitFor } from "storybook/test";
import { api } from "../../storybook/api";
import { CHIEF, NOW } from "../../storybook/fixtures";
import { TeachComputerOverlayControl } from "./TeachComputerOverlay";

const COMPUTER: ComputerStatus = {
  botId: CHIEF.id,
  mode: "team",
  kind: "none",
  state: "running",
  controlHolder: "user",
  controlBotId: null,
  takeoverRequested: false,
  screenAvailable: true,
  screenWidth: 1280,
  screenHeight: 800,
  homeRevision: null,
  busyBotName: null,
  canUpdate: false,
  terminalAvailable: true,
};

const RECORDING: TaughtSkill = {
  id: "skill-1",
  botId: CHIEF.id,
  name: "Export",
  goal: "Export weekly CRM list",
  status: "recording",
  playbook: {
    whenToUse: "",
    inputs: [],
    steps: [],
    howToCheck: "",
    whatToReturn: "",
    approvalBoundaries: "",
    failureHandling: "",
  },
  recording: { events: [], snapshots: [] },
  startedAt: NOW,
  expiresAt: null,
  stoppedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const meta = {
  title: "Teach/Teach a task",
  component: TeachComputerOverlayControl,
  parameters: {
    layout: "centered",
    api: api({
      skills: { list: [], start: RECORDING },
      computer: { boot: COMPUTER },
    }),
  },
  args: { botId: CHIEF.id, computer: COMPUTER, onRefresh: fn(async () => {}) },
  decorators: [
    (Story) => (
      <div className="flex h-[320px] w-[420px] items-start justify-end">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TeachComputerOverlayControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};

export const Goal: Story = {
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole("button", { name: "Teach a task" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await userEvent.type(
      await screen.findByRole("textbox"),
      "Export this week's list from the CRM",
    );
  },
};

export const RecordingStarted: Story = {
  parameters: { api: api({ skills: { list: [RECORDING] } }) },
};

export const StatusCheckFailed: Story = {
  parameters: {
    api: api({
      skills: {
        list: () => {
          throw new ORPCError("BAD_REQUEST", { message: "Skills are unavailable" });
        },
      },
    }),
  },
};
