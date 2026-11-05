import type { Meta, StoryObj } from "@storybook/react-vite";
import { SharedSpaceRules } from "./SharedSpaceRules";

const meta = {
  title: "Settings/Shared space rules",
  component: SharedSpaceRules,
  parameters: { layout: "padded" },
} satisfies Meta<typeof SharedSpaceRules>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const OnInvite: Story = {
  args: { className: "mx-auto mt-4 max-w-sm text-start text-sm" },
};
