import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextOnlyMark } from "./TextOnlyMark";

const meta = {
  title: "Primitives/Text only mark",
  component: TextOnlyMark,
  parameters: { layout: "centered" },
} satisfies Meta<typeof TextOnlyMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const BesideModel: Story = {
  render: () => (
    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <span className="text-foreground">example-small</span>
      <TextOnlyMark />
    </span>
  ),
};
