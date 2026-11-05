import type { ComputerStatus } from "@labradoodle/contracts";
import { Button, Spinner } from "@labradoodle/ui-web";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../../storybook/api";
import { CHIEF, LEDGER } from "../../storybook/fixtures";
import { ComputerOverlay } from "./computer-overlay";

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

const meta = {
  title: "Shell/Computer overlay",
  component: ComputerOverlay,
  parameters: {
    api: api({
      skills: { list: [] },
      computer: {
        stop: computer({ state: "stopped", screenAvailable: false }),
        reset: computer(),
      },
    }),
  },
  args: {
    bot: CHIEF,
    computer: computer(),
    computerViewport: null,
    recordingSkill: null,
    teachBusy: false,
    hasControl: false,
    composerRunning: false,
    sending: false,
    booting: false,
    sendError: null,
    embeddedScreenUrl: SCREEN_URL,
    screenFrameRef: fn(),
    computerScreenError: null,
    computerBooting: null,
    onStopTeaching: fn(),
    onStopRun: fn(),
    onRelease: fn(async () => undefined),
    onTakeControl: fn(),
    onStart: fn(),
    onRefreshTeaching: fn(async () => undefined),
    onRefreshComputer: fn(async () => undefined),
    onClose: fn(),
  },
} satisfies Meta<typeof ComputerOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Booting: Story = {
  args: {
    computer: computer({ state: "booting", screenAvailable: false, controlHolder: "none" }),
    booting: true,
    computerBooting: booting,
  },
};

export const Running: Story = {
  args: {
    bot: LEDGER,
    computer: computer({ botId: LEDGER.id, controlBotId: LEDGER.id, mode: "dedicated" }),
    composerRunning: true,
    runStatus: "running",
  },
};

export const YouHaveControl: Story = {
  args: {
    computer: computer({ controlHolder: "user", controlBotId: null }),
    hasControl: true,
  },
};

export const NeedsYou: Story = {
  args: {
    computer: computer({ controlHolder: "user", controlBotId: null, takeoverRequested: true }),
    hasControl: true,
    composerRunning: true,
    runStatus: "running",
  },
};

export const Stopped: Story = {
  args: {
    computer: computer({ state: "stopped", screenAvailable: false, controlHolder: "none" }),
  },
};

export const BootError: Story = {
  args: {
    computer: computer({ state: "error", screenAvailable: false, controlHolder: "none" }),
    computerScreenError: screenError,
  },
};

export const SendError: Story = {
  args: { sendError: "Could not send your message. Check your connection and try again." },
};
