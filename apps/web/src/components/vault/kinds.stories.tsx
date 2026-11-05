import type { VaultKind } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { VaultTile } from "./kinds";

const KINDS: VaultKind[] = ["login", "card", "contact", "api_key", "variable"];

const meta = {
  title: "Vault/Item tile",
  component: VaultTile,
  parameters: { layout: "centered" },
  args: { kind: "login", title: "example.test" },
  argTypes: { kind: { control: "select", options: [...KINDS, null] } },
} satisfies Meta<typeof VaultTile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Login: Story = {};

export const AllKinds: Story = {
  render: (args) => (
    <div className="flex items-center gap-3">
      {KINDS.map((kind) => (
        <VaultTile key={kind} {...args} kind={kind} />
      ))}
    </div>
  ),
};

export const Unreadable: Story = { args: { kind: null } };
