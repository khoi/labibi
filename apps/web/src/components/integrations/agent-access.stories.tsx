import { BOT_COLOR_LIST } from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useArgs } from "storybook/preview-api";
import { fn } from "storybook/test";
import { BOTS, bot, CHIEF, SCOUT } from "../../storybook/fixtures";
import type { AgentAccess } from "./agent-access";
import { AgentAccessControl } from "./agent-access";

const CREW = [
  ...BOTS,
  bot({ id: "bot-4", name: "Quill", color: BOT_COLOR_LIST[3]!.hex }),
  bot({ id: "bot-5", name: "Atlas", color: BOT_COLOR_LIST[4]!.hex }),
  bot({ id: "bot-6", name: "Juniper", color: BOT_COLOR_LIST[5]!.hex }),
];

const meta = {
  title: "Integrations/Agent access",
  component: AgentAccessControl,
  parameters: { layout: "centered" },
  args: { bots: BOTS, access: { allBots: true, botIds: [] }, onChange: fn() },
  render: function Render(args) {
    const [, updateArgs] = useArgs();
    return (
      <AgentAccessControl
        {...args}
        onChange={(access: AgentAccess) => {
          args.onChange(access);
          updateArgs({ access });
        }}
      />
    );
  },
} satisfies Meta<typeof AgentAccessControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllBots: Story = {};

export const SomeBots: Story = {
  args: { access: { allBots: false, botIds: [CHIEF.id, SCOUT.id] } },
};

export const NoBots: Story = {
  args: { access: { allBots: false, botIds: [] } },
};

export const ManyPicked: Story = {
  args: { bots: CREW, access: { allBots: false, botIds: CREW.map((member) => member.id) } },
};

export const Disabled: Story = {
  args: { access: { allBots: false, botIds: [CHIEF.id] }, disabled: true },
};

export const MenuOpen: Story = {
  args: { access: { allBots: false, botIds: [CHIEF.id, SCOUT.id] } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button"));
  },
};
