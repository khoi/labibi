import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "./field.js";
import { RadioGroup, RadioGroupItem } from "./radio-group.js";

const visibility = [
  { value: "private", label: "Only me" },
  { value: "space", label: "Everyone in the space" },
  { value: "link", label: "Anyone with the link" },
];

const meta = {
  title: "Primitives/Radio group",
  component: RadioGroup,
  parameters: { layout: "centered" },
  args: { defaultValue: "space", "aria-label": "Who can open this page" },
  argTypes: { disabled: { control: "boolean" } },
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <RadioGroup {...args} className="w-64">
      {visibility.map((option) => (
        <Field key={option.value} orientation="horizontal">
          <RadioGroupItem value={option.value} id={`radio-${option.value}`} />
          <FieldLabel htmlFor={`radio-${option.value}`} className="font-normal">
            {option.label}
          </FieldLabel>
        </Field>
      ))}
    </RadioGroup>
  ),
};

export const Cards: Story = {
  args: { defaultValue: "keep", "aria-label": "Memories" },
  render: (args) => (
    <RadioGroup {...args} className="w-80">
      {[
        { value: "keep", title: "Keep memories", description: "Other bots can still use them." },
        {
          value: "delete",
          title: "Delete memories",
          description: "Removes everything Scout learned.",
        },
      ].map((option) => (
        <FieldLabel key={option.value} htmlFor={`radio-card-${option.value}`}>
          <Field orientation="horizontal">
            <RadioGroupItem value={option.value} id={`radio-card-${option.value}`} />
            <FieldContent>
              <FieldTitle>{option.title}</FieldTitle>
              <FieldDescription>{option.description}</FieldDescription>
            </FieldContent>
          </Field>
        </FieldLabel>
      ))}
    </RadioGroup>
  ),
};

export const Disabled: Story = { ...Default, args: { disabled: true } };

export const Invalid: Story = {
  args: { defaultValue: undefined },
  render: (args) => (
    <RadioGroup {...args} className="w-64">
      {visibility.map((option) => (
        <Field key={option.value} orientation="horizontal" data-invalid>
          <RadioGroupItem value={option.value} id={`radio-invalid-${option.value}`} aria-invalid />
          <FieldLabel htmlFor={`radio-invalid-${option.value}`} className="font-normal">
            {option.label}
          </FieldLabel>
        </Field>
      ))}
    </RadioGroup>
  ),
};
