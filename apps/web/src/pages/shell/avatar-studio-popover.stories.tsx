import { BOT_COLOR_LIST } from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn, screen, userEvent } from "storybook/test";
import { CHIEF } from "../../storybook/fixtures";
import type { AvatarStudioPopoverProps } from "./avatar-studio-popover";
import { AvatarStudioPopover, BotLookPicker } from "./avatar-studio-popover";

function Controlled(props: AvatarStudioPopoverProps) {
  const [value, setValue] = useState(props.value);
  return (
    <AvatarStudioPopover
      {...props}
      value={value}
      onChange={(next) => {
        props.onChange(next);
        setValue(next);
      }}
    />
  );
}

function LookPicker({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="w-72">
      <BotLookPicker value={value} identity={CHIEF.id} onChange={setValue} />
    </div>
  );
}

const openStudio = async () => {
  await userEvent.click(await screen.findByRole("button", { name: "Customize bot avatar" }));
  await screen.findByText("Avatar Studio");
};

const meta = {
  title: "Shell/Avatar studio",
  component: AvatarStudioPopover,
  parameters: { layout: "centered" },
  args: {
    value: BOT_COLOR_LIST[2]!.hex,
    identity: CHIEF.id,
    status: "idle",
    size: 72,
    onChange: fn(),
  },
  render: (args) => <Controlled {...args} />,
} satisfies Meta<typeof AvatarStudioPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Open: Story = { play: openStudio };

export const OpenWithShape: Story = {
  args: { value: `${BOT_COLOR_LIST[5]!.hex}::shape_3` },
  play: openStudio,
};

export const UploadTab: Story = {
  play: async () => {
    await openStudio();
    await userEvent.click(screen.getByRole("tab", { name: "Upload" }));
  },
};

export const Disabled: Story = { args: { disabled: true } };

export const LookPickerOnly: Story = {
  render: () => <LookPicker initial={`${BOT_COLOR_LIST[1]!.hex}::shape_0`} />,
};
