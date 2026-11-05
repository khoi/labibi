import type { LoginFieldInput } from "@labradoodle/contracts";
import { LOGIN_FIELD_LIMIT } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useArgs } from "storybook/preview-api";
import { fn } from "storybook/test";
import { LoginFieldsInput } from "./LoginFieldsInput";

const meta = {
  title: "Vault/Login fields",
  component: LoginFieldsInput,
  parameters: { layout: "padded" },
  args: {
    fields: [
      { label: "Email", value: "ada@example.test", hidden: false },
      { label: "Password", value: "correct-horse-battery", hidden: true },
    ],
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  render: function Render(args) {
    const [, updateArgs] = useArgs();
    return (
      <LoginFieldsInput
        {...args}
        onChange={(fields: LoginFieldInput[]) => {
          args.onChange(fields);
          updateArgs({ fields });
        }}
      />
    );
  },
} satisfies Meta<typeof LoginFieldsInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Editable: Story = {};

export const AskedByChat: Story = {
  args: {
    fixedLabels: true,
    displayLabels: ["Email", "Password", "Workspace code"],
    fields: [
      { label: "email", value: "", hidden: false },
      { label: "password", value: "", hidden: true },
      { label: "workspace", value: "", hidden: true },
    ],
  },
};

export const AtLimit: Story = {
  args: {
    fields: Array.from({ length: LOGIN_FIELD_LIMIT }, (_, index) => ({
      label: index === 0 ? "Username" : `Recovery code ${index}`,
      value: index === 0 ? "ada" : `code-${index}`,
      hidden: index > 0,
    })),
  },
};

export const Disabled: Story = { args: { disabled: true } };
