import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronLeftIcon, ChevronRightIcon, CopyIcon } from "lucide-react";
import { Button } from "./button.js";
import { ButtonGroup } from "./button-group.js";
import { Input } from "./input.js";

const meta = {
  title: "Primitives/Button group",
  component: ButtonGroup,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ButtonGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FieldAndButton: Story = {
  render: (args) => (
    <ButtonGroup {...args} className="w-96">
      <Input aria-label="Invite link" readOnly value="https://labradoodle.example.test/join/7fq2" />
      <Button variant="outline">
        <CopyIcon />
        Copy
      </Button>
    </ButtonGroup>
  ),
};

export const Buttons: Story = {
  render: (args) => (
    <ButtonGroup {...args}>
      <Button variant="outline" size="icon" aria-label="Previous run">
        <ChevronLeftIcon />
      </Button>
      <Button variant="outline">Run 4 of 12</Button>
      <Button variant="outline" size="icon" aria-label="Next run">
        <ChevronRightIcon />
      </Button>
    </ButtonGroup>
  ),
};

export const Invalid: Story = {
  render: (args) => (
    <ButtonGroup {...args} className="w-96">
      <Input aria-label="Invite code" aria-invalid defaultValue="WRONG-CODE" />
      <Button>Join</Button>
    </ButtonGroup>
  ),
};

export const PasswordField: Story = {
  render: (args) => (
    <ButtonGroup {...args} className="w-96">
      <Input aria-label="API key" type="password" defaultValue="example-secret-key" />
      <Button>Save</Button>
    </ButtonGroup>
  ),
};
