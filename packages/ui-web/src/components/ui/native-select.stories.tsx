import type { Meta, StoryObj } from "@storybook/react-vite";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "./native-select.js";

const languages = (
  <>
    <NativeSelectOption value="en">English</NativeSelectOption>
    <NativeSelectOption value="de">Deutsch</NativeSelectOption>
    <NativeSelectOption value="es">Español</NativeSelectOption>
    <NativeSelectOption value="ko">한국어</NativeSelectOption>
  </>
);

const meta = {
  title: "Primitives/Native select",
  component: NativeSelect,
  parameters: { layout: "centered" },
  args: { "aria-label": "Language", defaultValue: "en", children: languages },
  argTypes: {
    size: { control: "inline-radio", options: ["default", "sm"] },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof NativeSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Small: Story = { args: { size: "sm" } };

export const Grouped: Story = {
  args: {
    "aria-label": "Model",
    defaultValue: "example-large",
    className: "w-56",
    children: (
      <>
        <NativeSelectOptGroup label="Example AI">
          <NativeSelectOption value="example-large">example-large</NativeSelectOption>
          <NativeSelectOption value="example-small">example-small</NativeSelectOption>
        </NativeSelectOptGroup>
        <NativeSelectOptGroup label="On this computer">
          <NativeSelectOption value="local-7b">local-7b</NativeSelectOption>
          <NativeSelectOption value="local-13b" disabled>
            local-13b
          </NativeSelectOption>
        </NativeSelectOptGroup>
      </>
    ),
  },
};

export const Invalid: Story = { args: { "aria-invalid": true } };

export const Disabled: Story = { args: { disabled: true } };
