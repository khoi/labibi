import type { TaughtSkill } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../../storybook/api";
import { CHIEF, NOW } from "../../storybook/fixtures";
import { TeachRecordingChrome, TeachStopButton } from "./TeachRecordingChrome";

const RECORDING: TaughtSkill = {
  id: "skill-1",
  botId: CHIEF.id,
  name: "Export",
  goal: "Export this week's list from the CRM and drop it in the shared folder",
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
  expiresAt: new Date(Date.now() + 7.5 * 60_000).toISOString(),
  stoppedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const meta = {
  title: "Teach/Recording chrome",
  component: TeachRecordingChrome,
  parameters: {
    layout: "padded",
    api: api({ computer: { input: { ok: true } } }),
  },
  args: { recording: RECORDING, botId: CHIEF.id, onStop: fn() },
  decorators: [
    (Story) => (
      <div className="w-[360px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TeachRecordingChrome>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Panel: Story = {};

export const Stopping: Story = { args: { busy: true } };

export const Overlay: Story = {
  args: { variant: "overlay" },
  render: (args) => (
    <div className="flex w-[640px] items-center gap-2 rounded-[11px] border border-border bg-card py-2 pe-3">
      <TeachRecordingChrome {...args} />
      <TeachStopButton busy={args.busy} onStop={args.onStop} />
    </div>
  ),
};

export const TimeUp: Story = {
  args: { recording: { ...RECORDING, expiresAt: NOW } },
};
