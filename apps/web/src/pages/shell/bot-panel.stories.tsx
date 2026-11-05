import type { Bot, ModelCatalogEntry, ModelCredential, Routine } from "@labradoodle/contracts";
import { BOT_COLOR_LIST } from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, screen, userEvent } from "storybook/test";
import { api } from "../../storybook/api";
import { bot, NOW } from "../../storybook/fixtures";
import { RoutineList } from "../RoutineEditor";
import { BotSettings } from "./bot-panel";
import { ComputerPanel } from "./computer-panel";

const inbox: Bot = bot({
  id: "bot-inbox",
  name: "Inbox",
  title: "Sorts the demo inbox",
  description: "Files routine mail for ada@example.test and leaves the rest for review.",
  instructions: "File routine mail. Ask before sending anything.",
  color: BOT_COLOR_LIST[5]!.hex,
  modelProvider: "example",
  modelId: "example-large",
});

const credentials: ModelCredential[] = [
  {
    id: "cred-example",
    provider: "example",
    label: "Example AI",
    hasKey: true,
    isDefault: true,
    modelId: "example-large",
  },
];

const catalog: ModelCatalogEntry[] = [
  {
    provider: "example",
    providerName: "Example AI",
    id: "example-large",
    label: "Example Large",
    billing: "",
    reasoning: true,
    thinkingLevels: ["low", "medium", "high"],
  },
  {
    provider: "example",
    providerName: "Example AI",
    id: "example-small",
    label: "Example Small",
    billing: "",
  },
];

const routines: Routine[] = [
  {
    id: "routine-1",
    botId: inbox.id,
    name: "Weekday inbox",
    prompt: "Read the demo inbox, file the routine mail, and list anything that needs a person.",
    crons: ["0 8 * * 1-5"],
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
    lastRunAt: NOW,
    nextRunAt: "2026-10-27T07:00:00.000Z",
    createdAt: NOW,
  },
];

const meta = {
  title: "Shell/Bot settings",
  component: BotSettings,
  parameters: {
    layout: "padded",
    api: api({
      voice: {
        voices: [
          { id: "voice-calm", label: "Calm" },
          { id: "voice-bright", label: "Bright" },
        ],
      },
      models: { credentials, list: catalog },
      scratchpad: {
        list: [
          {
            id: "scratch-1",
            botId: inbox.id,
            title: "Reply to the invoice thread",
            status: "open",
            notes: "",
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
      },
      memory: {
        list: [
          {
            id: "memory-1",
            scope: "bot",
            botId: inbox.id,
            path: "MEMORY.md",
            content: "- Ada prefers short summaries.\n- Invoices go to the finance folder.",
            revision: 1,
            updatedAt: NOW,
          },
        ],
        budget: { limitBytes: 16_000, usedBytes: 1_200, documents: [], omitted: [] },
      },
      pages: {
        list: {
          items: [
            {
              id: "page-1",
              title: "Inbox triage report",
              botId: inbox.id,
              groupId: null,
              visibility: "private",
              currentVersion: 2,
              pinned: true,
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
          nextCursor: null,
        },
      },
    }),
  },
  decorators: [
    (Story) => (
      <div style={{ width: 400 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    bot: inbox,
    tab: "settings",
    onTabChange: fn(),
    memoryProviderConfigured: false,
    onOpenConnections: fn(),
    onSave: fn(async () => undefined),
    onExport: fn(async () => undefined),
    onClear: fn(),
  },
} satisfies Meta<typeof BotSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Advanced: Story = {};

export const MemoryAndDisabledTools: Story = {
  args: {
    memoryProviderConfigured: true,
    bot: { ...inbox, memoryScope: "isolated", disabledBuiltinTools: ["shell", "browser_navigate"] },
  },
};

export const Computer: Story = {
  args: {
    tab: "computer",
    computer: (
      <ComputerPanel
        bot={inbox}
        computer={null}
        computerOpen={false}
        embeddedScreenUrl={null}
        screenFrameRef={fn()}
        computerScreenError={null}
        computerBooting={null}
        booting={false}
        showingRecoveryHint={false}
        showComputerRecoveryHint={false}
        onRecovered={fn()}
        onRecoveryDismissed={fn()}
        onOpen={fn()}
      />
    ),
  },
};

export const Routines: Story = {
  args: {
    tab: "routines",
    routines: <RoutineList routines={routines} onCreate={fn()} onEdit={fn()} onStop={fn()} />,
  },
};

export const Pages: Story = { args: { tab: "pages" } };

export const SaveError: Story = {
  args: { onSave: fn(async () => Promise.reject(new Error("Could not reach the server"))) },
  play: async () => {
    await userEvent.click(
      await screen.findByRole("switch", { name: "When it finishes or needs input" }),
    );
    (await screen.findByText("Could not reach the server")).scrollIntoView({ block: "center" });
  },
};
