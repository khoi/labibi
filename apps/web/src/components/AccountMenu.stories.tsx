import type { AccountSecurity } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, screen } from "storybook/test";
import { api } from "../storybook/api";
import { SPACE_ID } from "../storybook/fixtures";
import { AccountMenu } from "./AccountMenu";

const SECURITY: AccountSecurity = {
  hasPassword: true,
  passwordChangeEnabled: true,
  freshOidcAuth: false,
  ssoLinked: false,
  emailDeletion: true,
  sso: null,
};

const meta = {
  title: "Account/Account menu",
  component: AccountMenu,
  parameters: { http: { "/api/auth/account-security": SECURITY } },
  args: { signingOut: false, onLogOut: fn() },
  decorators: [
    (Story) => (
      <div className="min-h-screen">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AccountMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Open: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Account" }));
  },
};

export const SeveralOrganizations: Story = {
  parameters: {
    api: api({
      organizations: {
        list: {
          activeOrganizationId: "org-1",
          organizations: [
            {
              id: "org-1",
              name: "Personal",
              defaultSpaceId: SPACE_ID,
              spaceIds: [SPACE_ID],
              canManage: true,
            },
            {
              id: "org-2",
              name: "Example Studio",
              defaultSpaceId: "space-2",
              spaceIds: ["space-2"],
              canManage: false,
            },
          ],
        },
      },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Account" }));
  },
};

export const DeleteAccount: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Account" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete account" }));
  },
};

export const SigningOut: Story = { args: { signingOut: true } };
