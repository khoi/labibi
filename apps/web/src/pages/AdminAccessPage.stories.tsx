import type { AccessGrant } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../storybook/api";
import { ME, NOW } from "../storybook/fixtures";
import { AdminAccessPage } from "./AdminAccessPage";

const grant = (
  overrides: Partial<AccessGrant> & Pick<AccessGrant, "id" | "email">,
): AccessGrant => ({
  creditCents: 0,
  freeMonths: 0,
  createdBy: "ada@example.test",
  status: "pending",
  createdAt: NOW,
  appliedAt: null,
  ...overrides,
});

const GRANTS: AccessGrant[] = [
  grant({ id: "grant-1", email: "sam@example.test", creditCents: 5_000, freeMonths: 3 }),
  grant({
    id: "grant-2",
    email: "lee@example.test",
    freeMonths: 1,
    status: "applied",
    appliedAt: NOW,
  }),
  grant({ id: "grant-3", email: "kim@example.test", creditCents: 2_500, status: "revoked" }),
];

const meta = {
  title: "Views/Admin access",
  component: AdminAccessPage,
  parameters: {
    route: "/admin/access",
    api: api({ me: { ...ME, isAdmin: true }, accessGrants: { list: GRANTS } }),
  },
} satisfies Meta<typeof AdminAccessPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Grants: Story = {};

export const NoGrants: Story = { parameters: { api: api({ accessGrants: { list: [] } }) } };

export const Loading: Story = {
  parameters: { api: api({ accessGrants: { list: () => new Promise(() => {}) } }) },
};

export const LoadFailed: Story = {
  parameters: {
    api: api({
      accessGrants: {
        list: () => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "The server is busy." });
        },
      },
    }),
  },
};
