import type { AuthCapabilities } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { spyOn } from "storybook/test";
import { NOW } from "../storybook/fixtures";
import { PasskeySettings } from "./PasskeySettings";

const CAPABILITIES: AuthCapabilities = {
  sso: null,
  passwordAuth: true,
  passwordReset: true,
  resetUrl: null,
  emailCode: true,
  passkeyRpId: window.location.hostname,
};

const PASSKEYS = [
  { id: "passkey-1", name: "Work laptop", createdAt: NOW },
  { id: "passkey-2", name: "Phone", createdAt: "2026-09-14T08:30:00.000Z" },
  { id: "passkey-3", name: null, createdAt: "2026-06-02T17:10:00.000Z" },
];

const LIST = "/api/auth/passkey/list-user-passkeys";

const meta = {
  title: "Settings/Passkeys",
  component: PasskeySettings,
  parameters: {
    layout: "padded",
    http: { "/api/auth/capabilities": CAPABILITIES, [LIST]: PASSKEYS },
  },
  beforeEach: () => {
    spyOn(PublicKeyCredential, "isUserVerifyingPlatformAuthenticatorAvailable").mockResolvedValue(
      true,
    );
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PasskeySettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Passkeys: Story = {};

export const Empty: Story = {
  parameters: { http: { [LIST]: [] } },
};

export const LoadFailed: Story = {
  parameters: { http: { [LIST]: null } },
};

export const Renaming: Story = {
  play: async ({ canvas, userEvent }) => {
    const [first] = await canvas.findAllByRole("button", { name: "Rename" });
    if (first) await userEvent.click(first);
  },
};

export const ConfirmDelete: Story = {
  play: async ({ canvas, userEvent }) => {
    const [first] = await canvas.findAllByRole("button", { name: "Delete" });
    if (first) await userEvent.click(first);
  },
};
