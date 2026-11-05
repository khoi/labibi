import type { DesktopUpdateState } from "@labradoodle/contracts";
import { Toaster } from "@labradoodle/ui-web";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DesktopUpdateSection, DesktopUpdatesProvider } from "./DesktopUpdates";

const IDLE: DesktopUpdateState = {
  phase: "idle",
  currentVersion: "1.4.0",
  availableVersion: null,
  percent: null,
  message: null,
  checkedAt: "2026-10-26T08:55:00.000Z",
};

function desktop(state: DesktopUpdateState) {
  return () => {
    const previous = window.rakazoDesktop;
    const answer = async () => state;
    window.rakazoDesktop = {
      platform: "darwin",
      window: {
        close: async () => undefined,
        minimize: async () => undefined,
        toggleMaximize: async () => undefined,
        state: async () => ({ minimized: false, maximized: false, fullScreen: false }),
      },
      oauth: { onCallback: () => () => undefined },
      update: {
        state: answer,
        check: async () => ({ ...state, checkedAt: new Date().toISOString() }),
        download: answer,
        install: answer,
      },
    };
    return () => {
      window.rakazoDesktop = previous;
    };
  };
}

const meta = {
  title: "Computer/Desktop updates",
  component: DesktopUpdateSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <DesktopUpdatesProvider>
        <div className="min-h-[400px] max-w-xl">
          <Story />
        </div>
        <Toaster />
      </DesktopUpdatesProvider>
    ),
  ],
} satisfies Meta<typeof DesktopUpdateSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UpToDate: Story = { beforeEach: desktop(IDLE) };

export const Checking: Story = {
  beforeEach: desktop({ ...IDLE, phase: "checking" }),
};

export const Downloading: Story = {
  beforeEach: desktop({ ...IDLE, phase: "downloading", availableVersion: "1.5.0", percent: 42 }),
};

export const ReadyToInstall: Story = {
  beforeEach: desktop({ ...IDLE, phase: "ready", availableVersion: "1.5.0" }),
};

export const Failed: Story = {
  beforeEach: desktop({
    ...IDLE,
    phase: "error",
    availableVersion: "1.5.0",
    message: "The download was interrupted. Try again.",
  }),
};
