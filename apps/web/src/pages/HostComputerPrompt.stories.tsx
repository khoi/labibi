import type { LabradoodleDesktop } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, screen } from "storybook/test";
import { ME } from "../storybook/fixtures";
import { HostComputerPrompt } from "./HostComputerPrompt";

function desktop(platform: string, managesHostChoice: boolean) {
  const bridge: Partial<LabradoodleDesktop> = {
    platform,
    computer: {
      managesHostChoice,
      requestAccess: fn(async () => false),
      revokeAccess: fn(async () => {}),
      onConfigure: () => () => {},
    },
  };
  return () => {
    window.rakazoDesktop = bridge as LabradoodleDesktop;
    return () => {
      delete window.rakazoDesktop;
    };
  };
}

const meta = {
  title: "Panels/Host computer prompt",
  component: HostComputerPrompt,
  args: {
    initialMe: { ...ME, canChooseHostComputer: true, computerHost: null },
    onMeUpdated: fn(),
  },
  beforeEach: desktop("darwin", true),
  decorators: [
    (Story) => (
      <div className="h-screen bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HostComputerPrompt>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mac: Story = {};

export const OtherComputer: Story = { beforeEach: desktop("linux", true) };

export const OutdatedDesktop: Story = {
  beforeEach: desktop("darwin", false),
  play: async ({ userEvent }) => {
    await userEvent.click(await screen.findByRole("button", { name: "Docker" }));
    await screen.findByRole("alert");
  },
};
