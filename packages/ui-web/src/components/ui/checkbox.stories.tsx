import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox } from "./checkbox.js";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "./field.js";

const meta = {
  title: "Primitives/Checkbox",
  component: Checkbox,
  parameters: { layout: "centered" },
  args: { "aria-label": "Keep tool results whole" },
  argTypes: {
    checked: { control: "boolean" },
    indeterminate: { control: "boolean" },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithLabel: Story = {
  render: (args) => (
    <Field orientation="horizontal">
      <Checkbox {...args} id="checkbox-verbatim" defaultChecked />
      <FieldLabel htmlFor="checkbox-verbatim">Keep tool results whole</FieldLabel>
    </Field>
  ),
};

export const States: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <Checkbox {...args} aria-label="Unchecked" />
      <Checkbox {...args} aria-label="Checked" defaultChecked />
      <Checkbox {...args} aria-label="Indeterminate" indeterminate />
      <Checkbox {...args} aria-label="Disabled" disabled />
      <Checkbox {...args} aria-label="Disabled and checked" disabled defaultChecked />
      <Checkbox {...args} aria-label="Invalid" aria-invalid />
    </div>
  ),
};

export const Group: Story = {
  render: (args) => (
    <FieldSet className="w-80">
      <FieldLegend variant="label">Notify me about</FieldLegend>
      <FieldDescription>Sent to ada.park@example.test</FieldDescription>
      {[
        { id: "mentions", label: "Mentions", checked: true },
        { id: "direct", label: "Direct messages", checked: true },
        { id: "routines", label: "Routine failures", checked: false },
      ].map((option) => (
        <Field key={option.id} orientation="horizontal">
          <Checkbox {...args} id={`notify-${option.id}`} defaultChecked={option.checked} />
          <FieldLabel htmlFor={`notify-${option.id}`} className="font-normal">
            {option.label}
          </FieldLabel>
        </Field>
      ))}
    </FieldSet>
  ),
};
