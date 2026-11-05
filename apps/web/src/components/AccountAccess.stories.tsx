import type { AccountSecurity } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { AccountAccess, LinkSsoRow } from "./AccountAccess";

const PASSWORD_ACCOUNT: AccountSecurity = {
  hasPassword: true,
  freshOidcAuth: false,
  ssoLinked: false,
  emailDeletion: false,
  sso: null,
};

const PASSWORDLESS_ACCOUNT: AccountSecurity = {
  hasPassword: false,
  freshOidcAuth: false,
  ssoLinked: true,
  emailDeletion: true,
  sso: { name: "Example SSO" },
};

const meta = {
  title: "Settings/Account access",
  component: AccountAccess,
  parameters: {
    layout: "padded",
    http: { "/api/auth/account-security": PASSWORD_ACCOUNT },
  },
  args: { onSecurity: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-xl divide-y divide-border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AccountAccess>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const DeleteWithPassword: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByTestId("delete-account"));
  },
};

export const DeleteWithoutPassword: Story = {
  parameters: { http: { "/api/auth/account-security": PASSWORDLESS_ACCOUNT } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByTestId("delete-account"));
  },
};

export const DeletionCodeSent: Story = {
  parameters: {
    http: {
      "/api/auth/account-security": PASSWORDLESS_ACCOUNT,
      "/api/auth/request-account-deletion": { ok: true },
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByTestId("delete-account"));
    await userEvent.click(await canvas.findByRole("button", { name: "Send deletion code" }));
  },
};

export const SecurityLoadFailed: Story = {
  parameters: { http: { "/api/auth/account-security": null } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByTestId("delete-account"));
  },
};

export const LinkSso: Story = {
  render: () => <LinkSsoRow />,
};
