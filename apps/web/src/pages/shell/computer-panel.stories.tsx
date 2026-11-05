import type { ComputerStatus } from "@labradoodle/contracts";
import { Button, Spinner } from "@labradoodle/ui-web";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../../storybook/api";
import { CHIEF } from "../../storybook/fixtures";
import { ComputerPanel } from "./computer-panel";

function computer(overrides: Partial<ComputerStatus> = {}): ComputerStatus {
  return {
    botId: CHIEF.id,
    mode: "team",
    kind: "fake",
    state: "running",
    controlHolder: "bot",
    controlBotId: CHIEF.id,
    takeoverRequested: false,
    screenAvailable: true,
    screenWidth: 1280,
    screenHeight: 800,
    homeRevision: null,
    busyBotName: null,
    canUpdate: true,
    terminalAvailable: true,
    ...overrides,
  };
}

const SCREEN_URL = `data:text/html,${encodeURIComponent(
  '<body style="margin:0;height:100vh;display:grid;place-items:center;background:linear-gradient(steelblue,midnightblue);font:15px system-ui;color:white"><div style="padding:24px 32px;border-radius:12px;background:rgba(255,255,255,0.15)">Live desktop</div></body>',
)}`;

const booting = (
  <span className="flex flex-col items-center gap-3">
    <Spinner aria-hidden className="size-5 motion-reduce:animate-none" />
    Booting live desktop…
  </span>
);

const screenError = (
  <div role="alert" className="flex flex-col items-center gap-3 px-6 text-center text-sm">
    <p className="text-destructive">Computer failed to boot</p>
    <Button variant="outline" size="sm" onClick={fn()}>
      Retry screen
    </Button>
  </div>
);

const stopped = computer({ state: "stopped", screenAvailable: false, controlHolder: "none" });

const meta = {
  title: "Shell/Computer panel",
  component: ComputerPanel,
  parameters: {
    layout: "padded",
    api: api({ health: { ok: true, version: "1.0.0" } }),
  },
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    bot: CHIEF,
    computer: computer(),
    computerOpen: false,
    embeddedScreenUrl: SCREEN_URL,
    screenFrameRef: fn(),
    computerScreenError: null,
    computerBooting: null,
    booting: false,
    showingRecoveryHint: false,
    showComputerRecoveryHint: false,
    sandboxProvider: "fake",
    onRecovered: fn(),
    onRecoveryDismissed: fn(),
    onOpenComputerSettings: fn(),
    onOpen: fn(),
    onCleanUpDisk: fn(),
    onDismissDiskWarning: fn(),
  },
} satisfies Meta<typeof ComputerPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Asleep: Story = { args: { computer: stopped } };

export const Booting: Story = {
  args: {
    computer: computer({ state: "booting", screenAvailable: false, controlHolder: "none" }),
    booting: true,
    computerBooting: booting,
  },
};

export const Running: Story = {};

export const BootError: Story = {
  args: {
    computer: computer({ state: "error", screenAvailable: false, controlHolder: "none" }),
    computerScreenError: screenError,
  },
};

export const DiskNearlyFull: Story = { args: { computer: computer({ diskFullPercent: 94 }) } };

export const ComputersUnavailable: Story = {
  args: {
    computer: null,
    sandboxProvider: "none",
    showComputerRecoveryHint: true,
    showingRecoveryHint: true,
  },
};

export const DesktopKind: Story = { args: { computer: computer({ kind: "desktop" }) } };
