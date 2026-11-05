import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog.js";
import { Field, FieldGroup, FieldLabel } from "./field.js";
import { Input } from "./input.js";
import { Textarea } from "./textarea.js";

const meta = {
  title: "Primitives/Dialog",
  component: Dialog,
  parameters: { layout: "centered" },
  args: { defaultOpen: true },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RenameBot: Story = {
  render: (args) => (
    <Dialog {...args}>
      <DialogTrigger render={<Button variant="outline" />}>Rename bot</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename bot</DialogTitle>
          <DialogDescription>Everyone in the space sees the new name.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="dialog-bot-name">Name</FieldLabel>
          <Input id="dialog-bot-name" defaultValue="Scout" />
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const Form: Story = {
  render: (args) => (
    <Dialog {...args}>
      <DialogTrigger render={<Button />}>New bot</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New bot</DialogTitle>
          <DialogDescription>Give it a name and tell it what to work on.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="dialog-new-name">Name</FieldLabel>
            <Input id="dialog-new-name" placeholder="Ledger" />
          </Field>
          <Field>
            <FieldLabel htmlFor="dialog-new-instructions">Instructions</FieldLabel>
            <Textarea
              id="dialog-new-instructions"
              defaultValue="Track invoices sent to billing@example.test and flag anything overdue."
            />
          </Field>
        </FieldGroup>
        <DialogFooter showCloseButton>
          <Button>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const WithoutCloseButton: Story = {
  render: (args) => (
    <Dialog {...args}>
      <DialogTrigger render={<Button variant="outline" />}>What's new</DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Routines can run on weekends</DialogTitle>
          <DialogDescription>
            Pick the days a routine runs from its schedule. Existing routines keep weekdays only.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button />}>Got it</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const Closed: Story = { ...RenameBot, args: { defaultOpen: false } };
