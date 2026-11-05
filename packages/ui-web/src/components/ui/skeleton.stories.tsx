import type { Meta, StoryObj } from "@storybook/react-vite";
import { Skeleton } from "./skeleton.js";

const meta = {
  title: "Primitives/Skeleton",
  component: Skeleton,
  parameters: { layout: "padded" },
  args: { className: "h-4 w-48" },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Message: Story = {
  render: (args) => (
    <div className="flex max-w-md gap-3">
      <Skeleton {...args} className="size-8 shrink-0 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton {...args} className="h-4 w-24" />
        <Skeleton {...args} className="h-4 w-full" />
        <Skeleton {...args} className="h-4 w-2/3" />
      </div>
    </div>
  ),
};

export const List: Story = {
  render: (args) => (
    <div className="flex max-w-xs flex-col gap-3">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton {...args} className="size-6 rounded-md" />
          <Skeleton {...args} className="h-4 flex-1" />
        </div>
      ))}
    </div>
  ),
};
