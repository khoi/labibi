import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageTileIcon } from "./page-icon";

const meta = {
  title: "Pages/Page tile icon",
  component: PageTileIcon,
  parameters: { layout: "centered" },
} satisfies Meta<typeof PageTileIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tile: Story = {};

export const OnCard: Story = {
  render: () => (
    <div className="flex items-center gap-[14px] rounded-[24px] bg-card px-5 py-4 ring-[0.5px] ring-border">
      <PageTileIcon />
      <span className="text-[15px] text-foreground">Q3 launch tracker</span>
    </div>
  ),
};
