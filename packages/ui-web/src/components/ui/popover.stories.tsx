import type { Meta, StoryObj } from "@storybook/react-vite";
import { CopyIcon, Share2Icon } from "lucide-react";
import { Button } from "./button.js";
import { ButtonGroup } from "./button-group.js";
import { Field, FieldLabel } from "./field.js";
import { Input } from "./input.js";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./popover.js";

const meta = {
  title: "Primitives/Popover",
  component: Popover,
  parameters: { layout: "centered" },
  args: { defaultOpen: true },
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Share: Story = {
  render: (args) => (
    <Popover {...args}>
      <PopoverTrigger render={<Button variant="outline" />}>
        <Share2Icon />
        Share
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <PopoverHeader>
          <PopoverTitle>Share this page</PopoverTitle>
          <PopoverDescription>Anyone with the link can read it.</PopoverDescription>
        </PopoverHeader>
        <ButtonGroup className="w-full">
          <Input aria-label="Page link" readOnly value="https://pages.example.test/p/launch-plan" />
          <Button variant="outline" size="icon" aria-label="Copy link">
            <CopyIcon />
          </Button>
        </ButtonGroup>
      </PopoverContent>
    </Popover>
  ),
};

export const WithForm: Story = {
  render: (args) => (
    <Popover {...args}>
      <PopoverTrigger render={<Button variant="outline" />}>Set limit</PopoverTrigger>
      <PopoverContent align="start">
        <PopoverHeader>
          <PopoverTitle>Monthly limit</PopoverTitle>
          <PopoverDescription>Bots pause when the space reaches it.</PopoverDescription>
        </PopoverHeader>
        <Field>
          <FieldLabel htmlFor="popover-limit">Messages</FieldLabel>
          <Input id="popover-limit" inputMode="numeric" defaultValue="5000" />
        </Field>
        <Button size="sm" className="self-end">
          Save
        </Button>
      </PopoverContent>
    </Popover>
  ),
};

export const Closed: Story = { ...Share, args: { defaultOpen: false } };
