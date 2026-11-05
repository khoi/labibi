import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox } from "./checkbox.js";
import { Input } from "./input.js";
import { Label } from "./label.js";

const meta = {
  title: "Primitives/Label",
  component: Label,
  parameters: { layout: "centered" },
  args: { children: "Bot name" },
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithInput: Story = {
  render: (args) => (
    <div className="flex w-72 flex-col gap-2">
      <Label {...args} htmlFor="label-bot-name" />
      <Input id="label-bot-name" defaultValue="Scout" />
    </div>
  ),
};

export const WrappingCheckbox: Story = {
  render: (args) => (
    <Label {...args} className="font-normal text-foreground">
      <Checkbox defaultChecked />
      example-large
    </Label>
  ),
};

export const Disabled: Story = {
  render: (args) => (
    <div className="group flex w-72 flex-col gap-2" data-disabled="true">
      <Label {...args} htmlFor="label-disabled">
        Space name
      </Label>
      <Input id="label-disabled" defaultValue="Research team" disabled />
    </div>
  ),
};
