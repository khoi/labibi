import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { useState } from "react";
import { Field, FieldLabel } from "./field.js";
import type { SelectOption } from "./option-select.js";
import { OptionSelect } from "./option-select.js";

const effort: readonly SelectOption<string>[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Maximum", disabled: true },
];

function Controlled(props: ComponentProps<typeof OptionSelect<string>>) {
  const [value, setValue] = useState(props.value);
  return (
    <Field className="w-60">
      <FieldLabel htmlFor="option-select-effort">Reasoning effort</FieldLabel>
      <OptionSelect {...props} id="option-select-effort" value={value} onValueChange={setValue} />
    </Field>
  );
}

const meta = {
  title: "Primitives/Option select",
  component: OptionSelect<string>,
  parameters: { layout: "centered" },
  args: { value: "medium", options: effort, onValueChange: () => {} },
  argTypes: {
    value: { control: "select", options: [null, ...effort.map((option) => option.value)] },
    size: { control: "inline-radio", options: ["default", "sm"] },
    onValueChange: { table: { disable: true } },
  },
  render: (args) => <Controlled key={String(args.value)} {...args} />,
} satisfies Meta<typeof OptionSelect<string>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NothingChosen: Story = { args: { value: null } };

export const Small: Story = { args: { size: "sm" } };

export const Disabled: Story = { args: { disabled: true } };
