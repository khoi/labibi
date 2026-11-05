import type { Meta, StoryObj } from "@storybook/react-vite";
import { useArgs } from "storybook/preview-api";
import { fn } from "storybook/test";
import { FoundModelPicker } from "./FoundModelPicker";

const FEW = ["example-large", "example-medium", "example-small"];
const MANY = [
  ...FEW,
  "example-large-vision",
  "example-medium-instruct",
  "example-small-instruct",
  "example-coder-large",
  "example-coder-small",
  "example-embed",
  "example-reasoning",
  "example-reasoning-mini",
  "example-long-context",
];
const OTHER = "__other__";

const meta = {
  title: "Settings/Found model picker",
  component: FoundModelPicker,
  parameters: { layout: "padded" },
  args: { models: FEW, value: "example-large", otherValue: OTHER, onChange: fn() },
  render: function Render(args) {
    const [, updateArgs] = useArgs();
    return (
      <div className="max-w-sm">
        <FoundModelPicker
          {...args}
          onChange={(value: string) => {
            updateArgs({ value });
            args.onChange(value);
          }}
        />
      </div>
    );
  },
} satisfies Meta<typeof FoundModelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Open: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Models from server" }));
  },
};

export const OpenWithSearch: Story = {
  args: { models: MANY },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Models from server" }));
  },
};
