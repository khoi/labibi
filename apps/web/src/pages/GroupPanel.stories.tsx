import { BOT_COLOR_LIST } from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, screen } from "storybook/test";
import { BOTS, bot, GROUP } from "../storybook/fixtures";
import { CreateGroupForm, GroupSettings } from "./GroupPanel";

const bots = [
  ...BOTS,
  bot({ id: "bot-4", name: "Quill", color: BOT_COLOR_LIST[3]!.hex }),
  bot({ id: "bot-5", name: "Atlas", color: BOT_COLOR_LIST[4]!.hex, status: "running" }),
];

const meta = {
  title: "Panels/Group panel",
  component: GroupSettings,
  parameters: { layout: "padded" },
  args: {
    group: GROUP,
    bots,
    onSave: fn(async () => {}),
    onRemove: fn(async () => {}),
    onClose: fn(),
    onOpenBot: fn(),
  },
  decorators: [
    (Story) => (
      <div className="h-[640px] w-[344px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GroupSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Settings: Story = {};

export const AllBots: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Show all" }));
  },
};

export const SaveFailed: Story = {
  args: {
    onSave: fn(async () => {
      throw new Error("Could not save group");
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByDisplayValue(GROUP.name), " crew");
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
    await canvas.findByRole("alert");
  },
};

export const ConfirmDelete: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Delete group" }));
    await screen.findByRole("alertdialog");
  },
};

const onCancel = fn();
const onCreate = fn(async () => {});
const onOpenBot = fn();

export const NewGroup: Story = {
  render: (args) => (
    <CreateGroupForm
      bots={args.bots}
      onCancel={onCancel}
      onCreate={onCreate}
      onOpenBot={onOpenBot}
    />
  ),
};
