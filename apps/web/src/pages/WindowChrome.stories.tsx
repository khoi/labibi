import type { LabradoodleDesktop } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { WindowChrome } from "./WindowChrome";

const framelessDesktop: Partial<LabradoodleDesktop> = {
  platform: "linux",
  window: {
    close: fn(async () => {}),
    minimize: fn(async () => {}),
    toggleMaximize: fn(async () => {}),
    state: async () => ({ minimized: false, maximized: false, fullScreen: false }),
  },
};

const meta = {
  title: "Panels/Window chrome",
  component: WindowChrome,
  parameters: { layout: "centered" },
} satisfies Meta<typeof WindowChrome>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FramelessWindow: Story = {
  beforeEach: () => {
    window.rakazoDesktop = framelessDesktop as LabradoodleDesktop;
    return () => {
      delete window.rakazoDesktop;
    };
  },
};
