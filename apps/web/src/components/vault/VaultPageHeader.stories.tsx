import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { VaultTile } from "./kinds";
import { VaultPageHeader } from "./VaultPageHeader";

const meta = {
  title: "Vault/Page header",
  component: VaultPageHeader,
  parameters: { layout: "padded" },
  args: { title: "New login", onBack: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof VaultPageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TitleOnly: Story = {};

export const WithItem: Story = {
  args: {
    title: "example.test",
    subtitle: "Login",
    leading: <VaultTile kind="login" title="example.test" />,
  },
};

export const LongTitle: Story = {
  args: {
    title: "Shared login for the quarterly planning workspace at example.test",
    subtitle: "Login",
    leading: <VaultTile kind="login" title="example.test" />,
  },
};
