import type { TaughtSkill } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../../storybook/api";
import { CHIEF, NOW } from "../../storybook/fixtures";
import { SkillDraftCard } from "./SkillDraftCard";

const DRAFT = {
  kind: "skill_draft",
  skillId: "skill-1",
  name: "Weekly report",
  goal: "Send a summary of the week every Friday",
  playbook: {
    whenToUse: "Fridays at 4 pm",
    inputs: ["Calendar", "Inbox"],
    steps: ["Collect the week's meetings", "Summarize decisions", "Email the summary"],
    howToCheck: "Every meeting is covered",
    whatToReturn: "A short email",
    approvalBoundaries: "Ask before sending",
    failureHandling: "Tell me what was missing",
  },
  status: "draft",
} as const;

const SKILL: TaughtSkill = {
  id: DRAFT.skillId,
  botId: CHIEF.id,
  name: DRAFT.name,
  goal: DRAFT.goal,
  status: "draft",
  playbook: {
    ...DRAFT.playbook,
    inputs: [...DRAFT.playbook.inputs],
    steps: [...DRAFT.playbook.steps],
  },
  recording: { events: [], snapshots: [] },
  startedAt: NOW,
  expiresAt: null,
  stoppedAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
};

const meta = {
  title: "Teach/Skill draft card",
  component: SkillDraftCard,
  parameters: {
    layout: "padded",
    api: api({
      skills: {
        updateDraft: SKILL,
        save: { ...SKILL, status: "saved" },
        testRun: { runId: "run-1" },
      },
    }),
  },
  args: {
    block: { ...DRAFT, playbook: SKILL.playbook },
    onRefresh: fn(async () => {}),
    onAddRoutine: fn(),
  },
} satisfies Meta<typeof SkillDraftCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Draft: Story = {};

export const Saved: Story = {
  args: { block: { ...DRAFT, playbook: SKILL.playbook, status: "saved" } },
};

export const Saving: Story = {
  parameters: { api: api({ skills: { updateDraft: () => new Promise(() => {}) } }) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
  },
};

export const SaveFailed: Story = {
  parameters: {
    api: api({
      skills: {
        updateDraft: () => {
          throw new ORPCError("BAD_REQUEST", { message: "Give the skill a name." });
        },
      },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
  },
};
