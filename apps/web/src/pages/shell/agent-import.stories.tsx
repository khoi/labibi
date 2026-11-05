import type { AgentImportPlan } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { api } from "../../storybook/api";
import { AgentImportForm } from "./agent-import";

const plan: AgentImportPlan = {
  source: "document",
  suggestedName: "Pebble",
  suggestedDescription: "Keeps the support inbox tidy and drafts replies.",
  instructions: [
    {
      id: "instructions:persona",
      title: "Persona",
      content: "You are Pebble, a calm support assistant. Keep replies short and kind.",
      role: "persona",
      stock: false,
      mentions: [],
    },
    {
      id: "instructions:working",
      title: "How to work",
      content: "Sort new tickets each morning. Ask before refunding anything.",
      role: "working",
      stock: false,
      mentions: ["HEARTBEAT.md"],
    },
  ],
  memory: [
    {
      id: "memory:customers",
      title: "customers",
      content: "Ada Park prefers email over calls.",
      path: "customers.md",
      spacePath: "customers.md",
      stock: false,
    },
    {
      id: "memory:notes",
      title: "notes",
      content: "Support portal login is in here.",
      path: "notes.md",
      spacePath: "notes-2.md",
      stock: false,
      containsKey: true,
    },
  ],
  skills: [
    {
      id: "skill:triage",
      title: "triage",
      name: "triage",
      description: "Labels new tickets by urgency.",
      content: "---\nname: triage\n---\nRead each new ticket and label it.\n",
      warnings: [],
      status: { kind: "ready" },
    },
    {
      id: "skill:export",
      title: "export",
      name: "export-2",
      description: "Exports tickets to a spreadsheet.",
      content: "---\nname: export\n---\nRun the export script.\n",
      warnings: ["runs_code"],
      status: { kind: "needs_review", reason: "runs_code" },
    },
  ],
  model: {
    id: "model:example",
    title: "example/example-large",
    provider: "example",
    providerName: "Example AI",
    modelId: "example-large",
    status: "needs_key",
  },
  mcpServers: [
    {
      id: "mcp:tickets",
      title: "tickets",
      name: "tickets",
      content: "https://tickets.example.test/mcp",
      warnings: ["needs_setup"],
      status: { kind: "needs_setup", needs: [{ kind: "credentials", names: ["Authorization"] }] },
    },
  ],
  routines: [
    {
      id: "routine:morning",
      title: "Morning sort",
      content: "Every weekday at 08:00\nSort the overnight tickets.",
      warnings: ["changed_schedule"],
      status: { kind: "ready" },
    },
  ],
  apiKeys: [],
  skipped: [
    { path: "BOOTSTRAP.md", reason: "runtime" },
    { path: "skills/broken/SKILL.md", reason: "invalid_skill" },
  ],
};

const pasteAndContinue: Story["play"] = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.type(
    canvas.getByRole("textbox", { name: "Paste the reply" }),
    "# Pebble\nKeep replies short.",
  );
  await userEvent.click(canvas.getByRole("button", { name: "Continue" }));
};

const meta = {
  title: "Shell/Agent import",
  component: AgentImportForm,
  parameters: {
    layout: "padded",
    api: api({ bots: { importPreview: plan } }),
  },
  decorators: [
    (Story) => (
      <div style={{ width: 384 }}>
        <Story />
      </div>
    ),
  ],
  args: { onClose: fn(), onCreated: fn() },
} satisfies Meta<typeof AgentImportForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Choose: Story = {};

export const Preview: Story = { play: pasteAndContinue };

export const InstructionsOnly: Story = {
  parameters: {
    api: api({
      bots: {
        importPreview: {
          ...plan,
          suggestedDescription: "",
          memory: [],
          skills: [],
          model: null,
          mcpServers: [],
          routines: [],
          skipped: [],
        },
      },
    }),
  },
  play: pasteAndContinue,
};

export const ReadFailed: Story = {
  parameters: {
    api: api({
      bots: {
        importPreview: () => {
          throw new ORPCError("BAD_REQUEST", { message: "This reply has no agent instructions." });
        },
      },
    }),
  },
  play: pasteAndContinue,
};
