import type { Meta, StoryObj } from "@storybook/react-vite";
import { Separator } from "./separator.js";

const meta = {
  title: "Primitives/Separator",
  component: Separator,
  parameters: { layout: "centered" },
  argTypes: { orientation: { control: "inline-radio", options: ["horizontal", "vertical"] } },
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  render: (args) => (
    <div className="w-72 text-sm">
      <div className="font-medium">Ada Park</div>
      <div className="text-muted-foreground">ada.park@example.test</div>
      <Separator {...args} className="my-3" />
      <div className="text-muted-foreground">Owner of Research team</div>
    </div>
  ),
};

export const Vertical: Story = {
  args: { orientation: "vertical" },
  render: (args) => (
    <div className="flex h-5 items-center gap-3 text-sm">
      <span>Chats</span>
      <Separator {...args} />
      <span>Routines</span>
      <Separator {...args} />
      <span>Memory</span>
    </div>
  ),
};
