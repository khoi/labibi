import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "./button.js";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
  SwitchField,
} from "./field.js";
import { Input } from "./input.js";
import { RadioGroup, RadioGroupItem } from "./radio-group.js";
import { Textarea } from "./textarea.js";

const meta = {
  title: "Primitives/Field",
  component: Field,
  parameters: { layout: "padded" },
  argTypes: {
    orientation: { control: "inline-radio", options: ["vertical", "horizontal", "responsive"] },
  },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Field {...args} className="max-w-sm">
      <FieldLabel htmlFor="field-bot-name">Name</FieldLabel>
      <Input id="field-bot-name" defaultValue="Scout" />
      <FieldDescription>Shown in chats and mentions.</FieldDescription>
    </Field>
  ),
};

export const Invalid: Story = {
  render: (args) => (
    <Field {...args} data-invalid className="max-w-sm">
      <FieldLabel htmlFor="field-email">Email</FieldLabel>
      <Input id="field-email" aria-invalid defaultValue="ada.park@" />
      <FieldError>Enter a full email address, like ada.park@example.test.</FieldError>
    </Field>
  ),
};

export const ManyErrors: Story = {
  render: (args) => (
    <Field {...args} data-invalid className="max-w-sm">
      <FieldLabel htmlFor="field-password">Password</FieldLabel>
      <Input id="field-password" type="password" aria-invalid defaultValue="short" />
      <FieldError
        errors={[
          { message: "Use at least 12 characters." },
          { message: "Add a number or a symbol." },
          { message: "Use at least 12 characters." },
        ]}
      />
    </Field>
  ),
};

function Switches() {
  const [email, setEmail] = useState(true);
  const [web, setWeb] = useState(false);
  return (
    <FieldGroup className="max-w-md">
      <SwitchField
        label="Let bots send email"
        description="Replies go out from bots@example.test."
        checked={email}
        onCheckedChange={setEmail}
      />
      <SwitchField label="Search the web" checked={web} onCheckedChange={setWeb} />
      <SwitchField
        label="Run code"
        description="Ask your admin to turn on computers for this space."
        checked={false}
        onCheckedChange={() => {}}
        disabled
      />
    </FieldGroup>
  );
}

export const SwitchFields: Story = { render: () => <Switches /> };

export const SettingsForm: Story = {
  render: () => (
    <form className="max-w-md" onSubmit={(event) => event.preventDefault()}>
      <FieldSet>
        <FieldLegend>Profile</FieldLegend>
        <FieldDescription>Bots address you by this name.</FieldDescription>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="field-display-name">Display name</FieldLabel>
            <Input id="field-display-name" defaultValue="Ada Park" />
          </Field>
          <Field>
            <FieldLabel htmlFor="field-about">About you</FieldLabel>
            <Textarea
              id="field-about"
              defaultValue="Product lead. Prefers short answers with links to sources."
            />
          </Field>
          <FieldSeparator>Reply length</FieldSeparator>
          <RadioGroup defaultValue="short">
            {[
              { value: "short", title: "Short", description: "A few sentences." },
              { value: "detailed", title: "Detailed", description: "Steps, sources and caveats." },
            ].map((option) => (
              <FieldLabel key={option.value} htmlFor={`field-length-${option.value}`}>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>{option.title}</FieldTitle>
                    <FieldDescription>{option.description}</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value={option.value} id={`field-length-${option.value}`} />
                </Field>
              </FieldLabel>
            ))}
          </RadioGroup>
          <Field orientation="horizontal">
            <Button type="submit">Save</Button>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Field>
        </FieldGroup>
      </FieldSet>
    </form>
  ),
};

export const Responsive: Story = {
  args: { orientation: "responsive" },
  render: (args) => (
    <FieldGroup className="max-w-2xl">
      <Field {...args}>
        <FieldContent>
          <FieldLabel htmlFor="field-timezone">Time zone</FieldLabel>
          <FieldDescription>Routines run on this clock.</FieldDescription>
        </FieldContent>
        <Input id="field-timezone" defaultValue="Europe/Lisbon" className="md:w-56" />
      </Field>
    </FieldGroup>
  ),
};
