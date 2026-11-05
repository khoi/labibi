import type { AuthCapabilities } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PasskeySignIn } from "./PasskeySignIn";

const PASSKEYS: AuthCapabilities = {
  sso: null,
  passwordAuth: true,
  passwordReset: true,
  resetUrl: null,
  emailCode: true,
  passkeyRpId: window.location.hostname,
};

const meta = {
  title: "Account/Passkey sign-in",
  component: PasskeySignIn,
  parameters: { layout: "centered", http: { "/api/auth/capabilities": PASSKEYS } },
  args: { className: "w-72", onSignedIn: fn(), onError: fn() },
  beforeEach: () => {
    const credential = window.PublicKeyCredential;
    const platform = credential.isUserVerifyingPlatformAuthenticatorAvailable;
    const conditional = credential.isConditionalMediationAvailable;
    credential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
    credential.isConditionalMediationAvailable = async () => false;
    return () => {
      credential.isUserVerifyingPlatformAuthenticatorAvailable = platform;
      credential.isConditionalMediationAvailable = conditional;
    };
  },
} satisfies Meta<typeof PasskeySignIn>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = {};

export const Disabled: Story = { args: { disabled: true } };
