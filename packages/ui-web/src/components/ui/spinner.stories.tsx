import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button.js";
import { Spinner } from "./spinner.js";

const meta = {
  title: "Primitives/Spinner",
  component: Spinner,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      {["size-3", "size-4", "size-6", "size-8"].map((size) => (
        <Spinner key={size} {...args} className={size} />
      ))}
    </div>
  ),
};

export const InButton: Story = {
  render: (args) => (
    <Button disabled>
      <Spinner {...args} />
      Saving
    </Button>
  ),
};

export const WithText: Story = {
  render: (args) => (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner {...args} />
      Connecting to Example AI…
    </div>
  ),
};
