import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field, FieldContent, FieldDescription, FieldLabel } from "./field.js";
import { Switch } from "./switch.js";

const meta = {
  title: "Primitives/Switch",
  component: Switch,
  parameters: { layout: "centered" },
  args: { "aria-label": "Search the web" },
  argTypes: {
    size: { control: "inline-radio", options: ["default", "sm"] },
    checked: { control: "boolean" },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const States: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <Switch {...args} aria-label="Off" />
      <Switch {...args} aria-label="On" defaultChecked />
      <Switch {...args} aria-label="Small off" size="sm" />
      <Switch {...args} aria-label="Small on" size="sm" defaultChecked />
      <Switch {...args} aria-label="Disabled" disabled />
      <Switch {...args} aria-label="Disabled on" disabled defaultChecked />
      <Switch {...args} aria-label="Invalid" aria-invalid />
    </div>
  ),
};

export const WithLabel: Story = {
  render: (args) => (
    <Field orientation="horizontal" className="w-80 items-start">
      <Switch {...args} id="switch-web" aria-label={undefined} defaultChecked className="mt-0.5" />
      <FieldContent>
        <FieldLabel htmlFor="switch-web">Search the web</FieldLabel>
        <FieldDescription>Scout can look things up when it isn't sure.</FieldDescription>
      </FieldContent>
    </Field>
  ),
};
