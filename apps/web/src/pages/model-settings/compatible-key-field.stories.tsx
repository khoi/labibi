import { Input } from "@labradoodle/ui-web";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { CompatibleKeyField } from "./compatible-key-field";

const meta = {
  title: "Settings/Model settings/Compatible key field",
  component: CompatibleKeyField,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  args: {
    baseUrl: "http://127.0.0.1:8000/v1",
    className: "block text-[13.5px] text-muted-foreground",
    children: (
      <Input aria-label="API key" type="password" placeholder="Optional" className="mt-2" />
    ),
  },
} satisfies Meta<typeof CompatibleKeyField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Folded: Story = {};

export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByText("API key"));
  },
};
