import type { MemoryDocument, SpaceMemoryConfig } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { api } from "../storybook/api";
import { NOW } from "../storybook/fixtures";
import { MemorySettingsOverlay } from "./MemorySettingsOverlay";

const DOCS: MemoryDocument[] = [
  {
    id: "memory-1",
    scope: "user",
    botId: null,
    path: "MEMORY.md",
    content:
      "# Team notes\n\n- Ada prefers short summaries.\n- Weekly report goes out on Mondays.\n- Invoices live in the finance sheet.",
    revision: 3,
    updatedAt: NOW,
  },
];

const CONNECTED: SpaceMemoryConfig = {
  provider: "honcho",
  settings: { mode: "local", baseUrl: "https://memory.example.test", workspaceId: "team-notes" },
  defaultMemoryScope: "shared",
  updatedAt: NOW,
};

async function openProviderForm(canvasElement: HTMLElement) {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(await body.findByRole("button", { name: "Connect memory provider" }));
}

const meta = {
  title: "Settings/Memory",
  component: MemorySettingsOverlay,
  parameters: {
    api: api({
      memory: {
        list: DOCS,
        connectProvider: (input) => ({
          provider: input.provider,
          settings: input.settings,
          defaultMemoryScope: input.defaultMemoryScope ?? "isolated",
          updatedAt: NOW,
        }),
        setDefaultScope: (input) => ({
          ...CONNECTED,
          defaultMemoryScope: input.defaultMemoryScope,
        }),
        disconnectProvider: { ok: true },
      },
    }),
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background">
        <Story />
      </div>
    ),
  ],
  args: { config: null, onClose: fn(), onConfigChange: fn(), onBusyChange: fn() },
} satisfies Meta<typeof MemorySettingsOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoProvider: Story = {};

export const ChoosingProvider: Story = {
  play: async ({ canvasElement }) => openProviderForm(canvasElement),
};

export const Connected: Story = { args: { config: CONNECTED } };

export const Loading: Story = { args: { config: undefined } };

export const NoSharedNotes: Story = { parameters: { api: api({ memory: { list: [] } }) } };

export const ConnectFailed: Story = {
  parameters: {
    api: api({
      memory: {
        connectProvider: () => {
          throw new ORPCError("BAD_REQUEST", { message: "The memory service rejected this key." });
        },
      },
    }),
  },
  play: async ({ canvasElement }) => {
    await openProviderForm(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.type(await body.findByLabelText("Organization API key"), "example-key-1234");
    await userEvent.click(body.getByRole("button", { name: "Connect" }));
  },
};
