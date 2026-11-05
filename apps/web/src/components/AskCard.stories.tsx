import { instructionUpdateDiff } from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../storybook/api";
import { CHIEF } from "../storybook/fixtures";
import type { AskBlock } from "./AskCard";
import { AskCard } from "./AskCard";

const approvalActions = [
  { id: "allow", label: "Allow once" },
  { id: "always", label: "Always allow this tool" },
  { id: "deny", label: "Deny" },
];

const cities: AskBlock = {
  kind: "ask",
  text: "Which city should I use?",
  status: "pending",
  actions: [
    { id: "berlin", label: "Berlin" },
    { id: "seoul", label: "Seoul" },
    { id: "lisbon", label: "Lisbon" },
  ],
};

const meta = {
  title: "Chat/Ask card",
  component: AskCard,
  parameters: { layout: "padded" },
  args: {
    block: cities,
    canAnswer: true,
    canDismiss: true,
    onAnswer: fn(),
    onDismiss: fn(),
  },
} satisfies Meta<typeof AskCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Question: Story = {};

export const Answered: Story = {
  args: { block: { ...cities, status: "answered", answer: "seoul" } },
};

export const NoLongerActive: Story = {
  args: {
    canAnswer: false,
    block: {
      kind: "ask",
      text: "Here's the reply I drafted. Send it?",
      detail: "Thanks Sam, Tuesday at 2 pm works for me.",
      detailFormat: "text",
      status: "pending",
    },
  },
};

export const Approval: Story = {
  args: {
    block: {
      kind: "ask",
      approvalEffectId: "effect-1",
      text: "Send this email from your inbox?",
      detail: "To: sam@example.test\nSubject: Re: Q3 report\n\nAttached is the draft.",
      status: "pending",
      actions: approvalActions,
    },
  },
};

export const InstructionUpdate: Story = {
  args: {
    block: {
      kind: "ask",
      approvalEffectId: "effect-5",
      text: "Update instructions?",
      status: "pending",
      instructionUpdate: {
        botId: CHIEF.id,
        before: "Reply in English.",
        after: "Reply in English. Keep summaries to one paragraph.",
        reason: "You asked for shorter summaries.",
      },
      detail: instructionUpdateDiff(
        "Reply in English.",
        "Reply in English. Keep summaries to one paragraph.",
      ),
      detailFormat: "code",
      actions: [
        { id: "allow", label: "Apply" },
        { id: "deny", label: "Dismiss" },
      ],
    },
  },
};

export const UndoInstructions: Story = {
  args: {
    block: {
      kind: "ask",
      text: "Instructions updated",
      status: "answered",
      answer: "allow",
      instructionUpdate: {
        botId: CHIEF.id,
        before: "Reply in English.",
        after: "Reply in English. Be brief.",
        reason: "You asked for brevity.",
        undoVersionId: "version-1",
      },
    },
  },
  parameters: {
    api: api({
      bots: { restoreInstructions: () => ({ ...CHIEF, instructions: "Reply in English." }) },
    }),
  },
};

export const SubmitFailed: Story = {
  args: {
    onAnswer: fn(async () => {
      throw new Error("The run already finished.");
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: /Seoul/ }));
  },
};
