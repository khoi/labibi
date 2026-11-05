import type { AccountSecurity } from "@labradoodle/contracts";
import { IDENTITY_CONFIRMATION_REQUIRED } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../storybook/api";
import { AccountDataSettings } from "./AccountDataSettings";

const PASSWORD_ACCOUNT: AccountSecurity = {
  hasPassword: true,
  freshOidcAuth: false,
  ssoLinked: false,
  emailDeletion: false,
  sso: null,
};

const meta = {
  title: "Settings/Account data",
  component: AccountDataSettings,
  parameters: { layout: "padded" },
  args: { onImported: fn(async () => {}), onImportAgent: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-xl divide-y divide-border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AccountDataSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithoutAgentImport: Story = { args: { onImportAgent: undefined } };

export const Exporting: Story = {
  parameters: { api: api({ export: { accountToken: () => new Promise(() => {}) } }) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByTestId("account-export"));
  },
};

export const ExportFailed: Story = {
  parameters: {
    api: api({
      export: {
        accountToken: () => {
          throw new ORPCError("FORBIDDEN", { message: "Exports are turned off for this account." });
        },
      },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByTestId("account-export"));
  },
};

export const ConfirmIdentity: Story = {
  parameters: {
    api: api({
      export: {
        accountToken: () => {
          throw new ORPCError(IDENTITY_CONFIRMATION_REQUIRED, {
            status: 403,
            message: "Confirm it's you",
          });
        },
      },
    }),
    http: { "/api/auth/account-security": PASSWORD_ACCOUNT },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByTestId("account-export"));
  },
};

export const Imported: Story = {
  parameters: { http: { "/api/account/import": { ok: true } } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(
      canvas.getByTestId("account-import-file"),
      new File(["zip"], "export.zip", { type: "application/zip" }),
    );
  },
};
