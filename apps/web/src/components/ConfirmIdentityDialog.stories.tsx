import type { AccountSecurity } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, screen } from "storybook/test";
import { ConfirmIdentityDialog } from "./ConfirmIdentityDialog";

const security = (overrides: Partial<AccountSecurity>) => ({
  http: {
    "/api/auth/account-security": {
      hasPassword: true,
      passwordChangeEnabled: true,
      freshOidcAuth: false,
      ssoLinked: false,
      emailDeletion: true,
      sso: null,
      ...overrides,
    } satisfies AccountSecurity,
    "/api/auth/request-identity-code": { ok: true },
    "/api/auth/confirm-identity": { ok: true },
  },
});

const meta = {
  title: "Account/Confirm identity",
  component: ConfirmIdentityDialog,
  parameters: security({}),
  args: { open: true, onDone: fn() },
  decorators: [
    (Story) => (
      <div className="min-h-screen">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConfirmIdentityDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Password: Story = {};

export const EmailCode: Story = {
  parameters: security({ hasPassword: false }),
};

export const CodeSent: Story = {
  parameters: security({ hasPassword: false }),
  play: async ({ userEvent }) => {
    await userEvent.click(await screen.findByRole("button", { name: "Email me a code" }));
  },
};

export const SingleSignOn: Story = {
  parameters: security({
    hasPassword: false,
    ssoLinked: true,
    sso: { name: "Example SSO" },
  }),
};

export const Unavailable: Story = {
  parameters: security({ hasPassword: false, emailDeletion: false }),
};
