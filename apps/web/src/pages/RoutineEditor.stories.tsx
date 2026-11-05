import type { Routine, RoutineRun } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useArgs } from "storybook/preview-api";
import { fn, screen } from "storybook/test";
import { api } from "../storybook/api";
import { CHIEF, NOW } from "../storybook/fixtures";
import { draftFromRoutine, emptyRoutineDraft, RoutineEditor, RoutineList } from "./RoutineEditor";

const routine: Routine = {
  id: "routine-1",
  botId: CHIEF.id,
  name: "Morning digest",
  prompt: "Summarize yesterday's messages and list anything that needs a reply today.",
  crons: ["0 9 * * 1-5"],
  timezone: "Europe/Berlin",
  active: true,
  notify: true,
  webhookEnabled: false,
  githubEnabled: false,
  messageProvider: null,
  modelProvider: null,
  modelId: null,
  thinkingLevel: null,
  watch: null,
  watchState: null,
  lastRunAt: "2026-10-26T07:00:00.000Z",
  nextRunAt: "2026-10-27T07:00:00.000Z",
  scheduleDelayed: false,
  createdAt: NOW,
  editable: true,
};

const inbound: Routine = {
  ...routine,
  id: "routine-2",
  name: "Triage new issues",
  prompt: "Label the new issue and post a short summary in the team chat.",
  crons: [],
  webhookEnabled: true,
  githubEnabled: true,
  messageProvider: "example-chat",
  modelProvider: "example",
  modelId: "example-large",
};

const watching: Routine = {
  ...routine,
  id: "routine-3",
  name: "Report watcher",
  prompt: "When the weekly report changes, tell me what moved.",
  crons: [],
  watch: { kind: "command", command: "cat reports/weekly.csv", everyMinutes: 30, loud: false },
  watchState: {
    checkedAt: "2026-10-26T08:30:00.000Z",
    outcome: "changed",
    fingerprint: "a1b2c3",
    detail: "Two rows changed",
  },
};

const runs: RoutineRun[] = [
  {
    id: "run-2",
    botId: CHIEF.id,
    groupId: null,
    status: "completed",
    error: null,
    createdAt: "2026-10-26T07:00:00.000Z",
    startedAt: "2026-10-26T07:00:00.000Z",
    lateSince: null,
    completedAt: "2026-10-26T07:01:10.000Z",
    messageId: "message-2",
  },
  {
    id: "run-1",
    botId: CHIEF.id,
    groupId: null,
    status: "failed",
    error: "Model request timed out after 120 seconds",
    createdAt: "2026-10-23T07:00:00.000Z",
    startedAt: "2026-10-23T07:00:00.000Z",
    lateSince: null,
    completedAt: "2026-10-23T07:02:00.000Z",
    messageId: null,
  },
];

const meta = {
  title: "Routines/Routine editor",
  component: RoutineEditor,
  parameters: {
    layout: "padded",
    api: api({
      models: { credentials: [], list: [] },
      routines: { list: [routine], history: { runs, nextCursor: null } },
    }),
  },
  args: {
    draft: emptyRoutineDraft(),
    editing: null,
    timezone: "Europe/Berlin",
    webhook: {
      path: `https://app.example.test/api/v1/bots/${CHIEF.id}/webhook`,
      secret: null,
      configured: false,
    },
    githubPath: `https://app.example.test/api/v1/bots/${CHIEF.id}/github`,
    messageProviders: ["example-chat"],
    saving: false,
    running: false,
    error: null,
    onChange: fn(),
    onBack: fn(),
    onClose: fn(),
    onSave: fn(),
    onTestRun: fn(),
    onDelete: fn(),
    onEnsureWebhook: fn(async () => {}),
  },
  decorators: [
    (Story) => (
      <div className="w-[384px]">
        <Story />
      </div>
    ),
  ],
  render: function Render(args) {
    const [, updateArgs] = useArgs<typeof args>();
    return (
      <RoutineEditor
        {...args}
        onChange={(draft) => {
          args.onChange(draft);
          updateArgs({ draft });
        }}
      />
    );
  },
} satisfies Meta<typeof RoutineEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewRoutine: Story = {};

export const Scheduled: Story = {
  args: { draft: draftFromRoutine(routine), editing: routine },
};

export const InboundTriggers: Story = {
  args: {
    draft: draftFromRoutine(inbound),
    editing: inbound,
    webhook: {
      path: `https://app.example.test/api/v1/bots/${CHIEF.id}/webhook`,
      secret: "story-webhook-secret",
      configured: true,
    },
  },
  parameters: { api: api({ routines: { list: [inbound] } }) },
};

export const ChangeTrigger: Story = {
  args: { draft: draftFromRoutine(watching), editing: watching },
  parameters: { api: api({ routines: { list: [watching] } }) },
};

export const AddTrigger: Story = {
  args: { draft: draftFromRoutine(routine), editing: routine },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Add trigger" }));
    await screen.findByRole("menu");
  },
};

export const SaveFailed: Story = {
  args: {
    draft: draftFromRoutine(routine),
    editing: { ...routine, scheduleDelayed: true },
    error: "Could not save routine",
  },
  parameters: { api: api({ routines: { list: [{ ...routine, scheduleDelayed: true }] } }) },
};

const onCreate = fn();
const onEdit = fn();
const onStop = fn();

export const List: Story = {
  render: () => (
    <RoutineList
      routines={[routine, inbound, { ...watching, active: false }]}
      runningRoutineId={routine.id}
      onCreate={onCreate}
      onEdit={onEdit}
      onStop={onStop}
    />
  ),
};
