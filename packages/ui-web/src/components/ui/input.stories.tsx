import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input, InputRevealLabelsProvider } from "./input.js";

const meta = {
  title: "Primitives/Input",
  component: Input,
  parameters: { layout: "centered" },
  args: { "aria-label": "Bot name", placeholder: "Bot name", className: "w-72" },
  argTypes: {
    size: { control: "inline-radio", options: ["default", "xl"] },
    type: { control: "select", options: ["text", "email", "password", "number", "url"] },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithValue: Story = { args: { defaultValue: "Scout" } };

export const Password: Story = {
  args: { type: "password", "aria-label": "API key", defaultValue: "example-secret-key" },
};

export const CustomRevealLabels: Story = {
  args: Password.args,
  render: (args) => (
    <InputRevealLabelsProvider show="Show key" hide="Hide key">
      <Input {...args} />
    </InputRevealLabelsProvider>
  ),
};

export const ExtraLarge: Story = {
  args: { size: "xl", type: "email", placeholder: "ada.park@example.test", "aria-label": "Email" },
};

export const Invalid: Story = { args: { "aria-invalid": true, defaultValue: "Scout!!" } };

export const Disabled: Story = { args: { disabled: true, defaultValue: "Scout" } };
