import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./select.js";

const models = [
  { value: "example-large", label: "example-large" },
  { value: "example-small", label: "example-small" },
  { value: "local-7b", label: "local-7b" },
  { value: "local-13b", label: "local-13b" },
];

const meta = {
  title: "Primitives/Select",
  component: Select,
  parameters: { layout: "centered" },
  args: { defaultOpen: true, defaultValue: "example-large", items: models },
  argTypes: { disabled: { control: "boolean" } },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Grouped: Story = {
  render: (args) => (
    <Select {...args}>
      <SelectTrigger aria-label="Model" className="w-52">
        <SelectValue placeholder="Choose a model" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Example AI</SelectLabel>
          <SelectItem value="example-large">example-large</SelectItem>
          <SelectItem value="example-small">example-small</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>On this computer</SelectLabel>
          <SelectItem value="local-7b">local-7b</SelectItem>
          <SelectItem value="local-13b" disabled>
            local-13b
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
};

export const Closed: Story = { ...Grouped, args: { defaultOpen: false } };

export const Placeholder: Story = {
  ...Grouped,
  args: { defaultOpen: false, defaultValue: null },
};

export const Small: Story = {
  args: { defaultOpen: false },
  render: (args) => (
    <Select {...args}>
      <SelectTrigger aria-label="Model" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {models.map((model) => (
            <SelectItem key={model.value} value={model.value}>
              {model.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
};

export const Invalid: Story = {
  args: { defaultOpen: false, defaultValue: null },
  render: (args) => (
    <Select {...args}>
      <SelectTrigger aria-label="Model" aria-invalid className="w-52">
        <SelectValue placeholder="Choose a model" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {models.map((model) => (
            <SelectItem key={model.value} value={model.value}>
              {model.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
};

export const Disabled: Story = { ...Grouped, args: { defaultOpen: false, disabled: true } };
