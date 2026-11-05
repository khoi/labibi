import type { AuthCapabilities } from "@labradoodle/contracts";
import { passkeyOfferDismissedKey } from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { USER_ID } from "../storybook/fixtures";
import { PasskeyOffer } from "./PasskeyOffer";

const PASSKEYS: AuthCapabilities = {
  sso: null,
  passwordAuth: true,
  passwordReset: true,
  resetUrl: null,
  emailCode: true,
  passkeyRpId: window.location.hostname,
};

const meta = {
  title: "Account/Passkey offer",
  component: PasskeyOffer,
  parameters: {
    layout: "centered",
    http: {
      "/api/auth/capabilities": PASSKEYS,
      "/api/auth/passkey/list-user-passkeys": [],
    },
  },
  beforeEach: () => {
    const credential = window.PublicKeyCredential;
    const platform = credential.isUserVerifyingPlatformAuthenticatorAvailable;
    const key = passkeyOfferDismissedKey(USER_ID);
    credential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
    localStorage.removeItem(key);
    return () => {
      credential.isUserVerifyingPlatformAuthenticatorAvailable = platform;
      localStorage.removeItem(key);
    };
  },
  decorators: [
    (Story) => (
      <div className="w-64">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PasskeyOffer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Offered: Story = {};
