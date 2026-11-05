import type { LabradoodleDesktop, LabradoodleDesktopDevice } from "@labradoodle/contracts";
import { USER_DEVICE_PATH } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ComputerDeviceSettings } from "./ComputerDeviceSettings";

const LAPTOP = { deviceId: "device-1", name: "Ada's laptop", connected: true };
const STUDIO = { deviceId: "device-2", name: "Studio desktop", connected: false };

function onDesktop(state: LabradoodleDesktopDevice, fail = false) {
  return () => {
    window.rakazoDesktop = {
      platform: "darwin",
      device: {
        state: async () => state,
        setAllowed: async (allowed: boolean) => {
          if (fail) throw new Error("Could not pair this computer");
          Object.assign(state, { allowed });
          return state;
        },
      },
    } as LabradoodleDesktop;
    return () => {
      delete window.rakazoDesktop;
    };
  };
}

const meta = {
  title: "Settings/Computer devices",
  component: ComputerDeviceSettings,
  parameters: {
    layout: "padded",
    http: { [USER_DEVICE_PATH]: { devices: [LAPTOP, STUDIO] } },
  },
} satisfies Meta<typeof ComputerDeviceSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Devices: Story = {};

export const ThisComputerOff: Story = {
  parameters: { http: { [USER_DEVICE_PATH]: { devices: [] } } },
  beforeEach: onDesktop({ deviceId: null, name: "Ada's laptop", allowed: false }),
};

export const ThisComputerOn: Story = {
  beforeEach: onDesktop({ deviceId: LAPTOP.deviceId, name: LAPTOP.name, allowed: true }),
};

export const ChangeFails: Story = {
  parameters: { http: { [USER_DEVICE_PATH]: { devices: [] } } },
  beforeEach: onDesktop({ deviceId: null, name: "Ada's laptop", allowed: false }, true),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("switch"));
  },
};
