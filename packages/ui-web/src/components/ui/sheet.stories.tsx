import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { Button } from "./button.js";
import { Field, FieldGroup, FieldLabel } from "./field.js";
import { Input } from "./input.js";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet.js";
import { Textarea } from "./textarea.js";

function BotSheet({
  side,
  ...props
}: ComponentProps<typeof Sheet> & { side: ComponentProps<typeof SheetContent>["side"] }) {
  return (
    <Sheet {...props}>
      <SheetTrigger render={<Button variant="outline" />}>Edit Scout</SheetTrigger>
      <SheetContent side={side}>
        <SheetHeader>
          <SheetTitle>Scout</SheetTitle>
          <SheetDescription>Finds sources and checks facts for the team.</SheetDescription>
        </SheetHeader>
        <FieldGroup className="px-4">
          <Field>
            <FieldLabel htmlFor={`sheet-name-${side}`}>Name</FieldLabel>
            <Input id={`sheet-name-${side}`} defaultValue="Scout" />
          </Field>
          <Field>
            <FieldLabel htmlFor={`sheet-instructions-${side}`}>Instructions</FieldLabel>
            <Textarea
              id={`sheet-instructions-${side}`}
              defaultValue="Cite at least two sources for every claim. Prefer primary sources."
            />
          </Field>
        </FieldGroup>
        <SheetFooter>
          <Button>Save</Button>
          <SheetClose render={<Button variant="outline" />}>Cancel</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const meta = {
  title: "Primitives/Sheet",
  component: Sheet,
  parameters: { layout: "centered" },
  args: { defaultOpen: true },
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Right: Story = { render: (args) => <BotSheet {...args} side="right" /> };

export const Left: Story = { render: (args) => <BotSheet {...args} side="left" /> };

export const Bottom: Story = { render: (args) => <BotSheet {...args} side="bottom" /> };

export const Closed: Story = { ...Right, args: { defaultOpen: false } };
