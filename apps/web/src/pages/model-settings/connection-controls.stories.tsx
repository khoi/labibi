import type { ModelCatalogEntry, ModelCredential } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { CompatibleKeyControls, ConnectionControls } from "./connection-controls";

const KEY_MODEL: ModelCatalogEntry = {
  provider: "example",
  providerName: "Example AI",
  id: "example-large",
  label: "Example Large",
  billing: "API key",
  auth: "api-key",
  catalogProbe: true,
};

const SUBSCRIPTION_MODEL: ModelCatalogEntry = {
  ...KEY_MODEL,
  auth: "both",
  subscription: true,
  signIn: "device-code",
  oauthLabel: "Sign in with Example AI",
};

const KEY_CREDENTIAL: ModelCredential = {
  id: "cred-example",
  provider: "example",
  label: "Example AI",
  hasKey: true,
  isDefault: true,
  modelId: "example-large",
  authKind: "api_key",
};

const OAUTH_BASE = {
  loginId: "login-1",
  provider: "example",
  verificationUri: "https://login.example.test/device",
  expiresInSeconds: 540,
};

const meta = {
  title: "Settings/Model settings/Connection controls",
  component: ConnectionControls,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
  args: {
    selected: KEY_MODEL,
    credential: undefined,
    acceptsKey: true,
    subscriptionSignIn: false,
    isOpenAiCompatible: false,
    isCloudflare: false,
    isCloudflareGateway: false,
    cloudflareRoutingReady: true,
    accountId: "",
    gatewayId: "",
    apiKey: "",
    pasteCode: "",
    busy: false,
    pending: null,
    oauth: null,
    oauthPending: false,
    popupBlocked: false,
    codeCopied: false,
    preflightTesting: false,
    preflightTarget: null,
    preflightSuccess: null,
    preflightFailure: null,
    beginSelectedSubscriptionSignIn: fn(),
    cancelOAuthAttempt: fn(),
    connectKey: fn(async () => undefined),
    copyOAuthCode: fn(),
    setAccountId: fn(),
    setGatewayId: fn(),
    setPasteCode: fn(),
    submitOAuthCode: fn(async () => undefined),
    testApiKeyConnection: fn(async () => undefined),
    testOAuthConnection: fn(async () => undefined),
    updateApiKey: fn(),
  },
} satisfies Meta<typeof ConnectionControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ApiKey: Story = {};

export const ApiKeySaved: Story = { args: { credential: KEY_CREDENTIAL } };

export const ApiKeyTestFailed: Story = {
  args: {
    apiKey: "example-key-1234567890",
    preflightTarget: "api-key",
    preflightFailure: {
      outcome: "unauthorized",
      message: "Example AI rejected this key.",
      nextAction: "Paste a key from your Example AI account.",
    },
  },
};

export const SubscriptionSignIn: Story = {
  args: { selected: SUBSCRIPTION_MODEL, subscriptionSignIn: true },
};

export const WaitingForDeviceCode: Story = {
  args: {
    selected: SUBSCRIPTION_MODEL,
    subscriptionSignIn: true,
    oauth: { ...OAUTH_BASE, mode: "device-code", userCode: "WXYZ-4821" },
  },
};

export const WaitingForPastedCode: Story = {
  args: {
    selected: { ...SUBSCRIPTION_MODEL, signIn: "auth-url" },
    subscriptionSignIn: true,
    pasteCode: "example-code",
    oauth: {
      ...OAUTH_BASE,
      mode: "auth-url",
      verificationUri: "https://login.example.test/authorize",
    },
  },
};

export const SignedIn: Story = {
  args: {
    selected: SUBSCRIPTION_MODEL,
    subscriptionSignIn: true,
    credential: { ...KEY_CREDENTIAL, hasKey: false, authKind: "oauth" },
  },
};

export const CompatibleServerKey: Story = {
  render: (args) => (
    <CompatibleKeyControls
      {...args}
      isOpenAiCompatible
      baseUrl="http://127.0.0.1:8000/v1"
      openAiCompatibleReady
    />
  ),
};
