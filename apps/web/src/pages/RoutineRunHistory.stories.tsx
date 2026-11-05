import type { RoutineRun } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../storybook/api";
import { CHIEF, GROUP } from "../storybook/fixtures";
import { RoutineRunHistory } from "./RoutineRunHistory";

function run(id: string, startedAt: string, overrides: Partial<RoutineRun> = {}): RoutineRun {
  return {
    id,
    botId: CHIEF.id,
    groupId: null,
    status: "completed",
    error: null,
    createdAt: startedAt,
    startedAt,
    lateSince: null,
    completedAt: startedAt,
    messageId: `reply-${id}`,
    ...overrides,
  };
}

const runs: RoutineRun[] = [
  run("run-5", "2026-10-26T07:02:00.000Z", {
    status: "running",
    completedAt: null,
    messageId: null,
  }),
  run("run-4", "2026-10-25T07:00:00.000Z"),
  run("run-3", "2026-10-24T09:40:00.000Z", { lateSince: "2026-10-24T07:00:00.000Z" }),
  run("run-2", "2026-10-23T07:00:00.000Z", {
    status: "failed",
    error: "Model request timed out after 120 seconds",
    messageId: null,
  }),
  run("run-1", "2026-10-22T07:00:00.000Z", { groupId: GROUP.id, messageId: null }),
];

const older = run("run-0", "2026-10-21T07:00:00.000Z");

const meta = {
  title: "Routines/Run history",
  component: RoutineRunHistory,
  parameters: {
    layout: "padded",
    api: api({ routines: { history: { runs, nextCursor: null } } }),
  },
  args: { routineId: "routine-1" },
  decorators: [
    (Story) => (
      <div className="w-[344px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RoutineRunHistory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Runs: Story = {};

export const OlderRuns: Story = {
  parameters: {
    api: api({
      routines: {
        history: (input) =>
          input.before
            ? { runs: [older], nextCursor: null }
            : { runs, nextCursor: { id: "run-1", createdAt: runs[4]!.createdAt } },
      },
    }),
  },
};

export const NoRuns: Story = {
  parameters: { api: api({ routines: { history: { runs: [], nextCursor: null } } }) },
};

export const Loading: Story = {
  parameters: { api: api({ routines: { history: () => new Promise(() => {}) } }) },
};

export const LoadFailed: Story = {
  parameters: {
    api: api({
      routines: {
        history: () => {
          throw new ORPCError("FORBIDDEN", { message: "Not allowed" });
        },
      },
    }),
  },
};
