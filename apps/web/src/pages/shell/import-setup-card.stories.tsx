import type { MessageBlock } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../../storybook/api";
import { CHIEF } from "../../storybook/fixtures";
import { ImportSetupCard } from "./import-setup-card";

const checklist: Extract<MessageBlock, { kind: "import_setup" }> = {
  kind: "import_setup",
  items: [
    {
      kind: "model",
      title: "example/example-large",
      provider: "example",
      providerName: "Example AI",
    },
    {
      kind: "mcp",
      serverId: "server-1",
      name: "files",
      needs: [
        { kind: "program", name: "npx" },
        { kind: "env", names: ["EXAMPLE_TOKEN"] },
      ],
    },
    {
      kind: "mcp",
      serverId: "server-2",
      name: "calendar",
      needs: [{ kind: "credentials", names: ["Authorization"] }],
    },
    { kind: "routine", routineId: "routine-1", name: "Morning brief" },
    { kind: "skill", name: "triage", needs: [{ kind: "requires", names: ["git", "curl"] }] },
  ],
};

const meta = {
  title: "Chat/Import setup card",
  component: ImportSetupCard,
  parameters: {
    layout: "padded",
    api: api({
      bots: {
        importSetupState: {
          providers: { example: false },
          serverIds: { "server-1": "unverifiable", "server-2": false },
          routineIds: { "routine-1": false },
        },
      },
    }),
  },
  args: { botId: CHIEF.id, block: checklist, onOpen: fn() },
} satisfies Meta<typeof ImportSetupCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NeedsSetup: Story = {};

export const PartlyDone: Story = {
  parameters: {
    api: api({
      bots: {
        importSetupState: {
          providers: { example: true },
          serverIds: { "server-1": "unverifiable", "server-2": true },
          routineIds: { "routine-1": false },
        },
      },
    }),
  },
};

export const Checking: Story = {
  parameters: { api: api({ bots: { importSetupState: () => new Promise(() => {}) } }) },
};

export const Complete: Story = {
  args: {
    block: {
      kind: "import_setup",
      items: checklist.items.filter((item) => item.kind === "model" || item.kind === "routine"),
    },
  },
  parameters: {
    api: api({
      bots: {
        importSetupState: {
          providers: { example: true },
          serverIds: {},
          routineIds: { "routine-1": true },
        },
      },
    }),
  },
};
