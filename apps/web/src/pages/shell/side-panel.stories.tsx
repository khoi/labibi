import type { ComputerStatus } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { rpc } from "../../lib/rpc";
import { api } from "../../storybook/api";
import { BOOTSTRAP, BOTS, CHIEF, GROUP, GROUP_THREAD, NOW } from "../../storybook/fixtures";
import { RoutineList } from "../RoutineEditor";
import { ComputerPanel } from "./computer-panel";
import { ShellSidePanel } from "./side-panel";

const failedComputer: ComputerStatus = {
  botId: CHIEF.id,
  mode: "team",
  kind: "fake",
  state: "error",
  controlHolder: "none",
  controlBotId: null,
  takeoverRequested: false,
  screenAvailable: false,
  screenWidth: 1280,
  screenHeight: 800,
  homeRevision: null,
  busyBotName: null,
  canUpdate: true,
  terminalAvailable: false,
};

const computerPanel = (computer: ComputerStatus | null) => (
  <ComputerPanel
    bot={CHIEF}
    computer={computer}
    computerOpen={false}
    embeddedScreenUrl={null}
    screenFrameRef={fn()}
    computerScreenError={
      computer?.state === "error" ? (
        <p role="alert" className="text-destructive">
          Computer failed to boot
        </p>
      ) : null
    }
    computerBooting={null}
    booting={false}
    showingRecoveryHint={false}
    showComputerRecoveryHint={false}
    onRecovered={fn()}
    onRecoveryDismissed={fn()}
    onOpen={fn()}
  />
);

const meta = {
  title: "Shell/Side panel",
  component: ShellSidePanel,
  parameters: {
    api: api({
      voice: { voices: [] },
      models: { credentials: [], list: [] },
      scratchpad: { list: [] },
      memory: {
        list: [],
        budget: { limitBytes: 16_000, usedBytes: 0, documents: [], omitted: [] },
      },
      pages: {
        list: {
          items: [
            {
              id: "page-1",
              title: "Launch checklist",
              botId: null,
              groupId: GROUP.id,
              visibility: "private",
              currentVersion: 1,
              pinned: false,
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
      <div className="relative flex bg-background" style={{ height: "100vh" }}>
        <div className="min-w-0 flex-1" />
        <Story />
      </div>
    ),
  ],
  args: {
    rpc,
    panel: "settings",
    setPanel: fn(),
    active: CHIEF,
    activeGroup: undefined,
    bots: BOTS,
    groups: [GROUP],
    setBots: fn(),
    setGroups: fn(),
    navigate: fn(),
    refreshBots: fn(async () => undefined),
    refreshThread: fn(async () => BOOTSTRAP.thread!),
    refreshGroupThread: fn(async () => GROUP_THREAD),
    computer: null,
    computerOpen: false,
    booting: false,
    computerPanel: computerPanel(null),
    routinesPanel: <RoutineList routines={[]} onCreate={fn()} onEdit={fn()} onStop={fn()} />,
    routineEditorProps: null,
    openBot: fn(),
    openCreatedBot: fn(),
    modelFocusRequest: 0,
    openSettings: fn(),
    memoryProviderConfigured: false,
    setAgentSkills: fn(),
    onClearBot: fn(),
    discardChatAttachments: fn(),
  },
} satisfies Meta<typeof ShellSidePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BotSettings: Story = {};

export const ComputerFailed: Story = {
  args: {
    panel: "computer",
    computer: failedComputer,
    computerPanel: computerPanel(failedComputer),
  },
};

export const CreateGroup: Story = { args: { panel: "create-group", active: undefined } };

export const GroupSettings: Story = {
  args: { panel: "group-settings", active: undefined, activeGroup: GROUP },
};

export const ImportAgent: Story = { args: { panel: "import-agent", active: undefined } };
