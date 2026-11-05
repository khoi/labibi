import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowUpIcon, PaperclipIcon, SearchIcon, XIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "./input-group.js";
import { Kbd } from "./kbd.js";

const meta = {
  title: "Primitives/Input group",
  component: InputGroup,
  parameters: { layout: "centered" },
  args: { className: "w-96" },
} satisfies Meta<typeof InputGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Search: Story = {
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupInput placeholder="Search bots" aria-label="Search bots" />
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupAddon align="inline-end">
        <Kbd>⌘K</Kbd>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const WithButton: Story = {
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupInput aria-label="Search bots" defaultValue="ledger" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Clear">
          <XIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const WithText: Story = {
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupAddon>
        <InputGroupText>https://</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput aria-label="Server address" defaultValue="tools" />
      <InputGroupAddon align="inline-end">
        <InputGroupText>.example.test/mcp</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const Composer: Story = {
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupTextarea
        aria-label="Message Scout"
        placeholder="Message Scout"
        defaultValue="Find three recent reviews of standing desks and summarize the trade-offs."
      />
      <InputGroupAddon align="block-end">
        <InputGroupButton size="icon-xs" aria-label="Attach a file">
          <PaperclipIcon />
        </InputGroupButton>
        <InputGroupText className="ml-auto">example-large</InputGroupText>
        <InputGroupButton size="icon-xs" variant="default" aria-label="Send">
          <ArrowUpIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const Invalid: Story = {
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupAddon>
        <InputGroupText>https://</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput aria-label="Server address" aria-invalid defaultValue="not a host" />
    </InputGroup>
  ),
};

export const Disabled: Story = {
  render: (args) => (
    <InputGroup {...args} data-disabled="true">
      <InputGroupInput aria-label="Search bots" placeholder="Search bots" disabled />
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
    </InputGroup>
  ),
};
