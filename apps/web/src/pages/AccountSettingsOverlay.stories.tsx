import type {
  AccountSecurity,
  ComputerProviderSettings,
  DesktopUpdateState,
  LabradoodleDesktop,
  UsageSummary,
  UserDeviceList,
} from "@labradoodle/contracts";
import { USER_DEVICE_PATH } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { DesktopUpdatesProvider } from "../components/DesktopUpdates";
import { api } from "../storybook/api";
import { ME, NOW } from "../storybook/fixtures";
import {
  ComputerSettingsPanel,
  GeneralSettingsPanels,
  UpdatesSettingsPanel,
  UsageSettingsPanel,
} from "./AccountSettingsOverlay";

const USAGE: UsageSummary = {
  runs: 128,
  inputTokens: 1_840_000,
  outputTokens: 312_000,
  totalTokens: 2_152_000,
  costUsd: 14.62,
  modelCalls: 604,
  models: [
    {
      provider: "Example AI",
      model: "example-large",
      inputTokens: 1_520_000,
      outputTokens: 268_000,
      totalTokens: 1_788_000,
      costUsd: 13.9,
      modelCalls: 410,
    },
    {
      provider: "Example AI",
      model: "example-small",
      inputTokens: 320_000,
      outputTokens: 44_000,
      totalTokens: 364_000,
      costUsd: 0.72,
      modelCalls: 194,
    },
  ],
};

const SECURITY: AccountSecurity = {
  hasPassword: true,
  passwordChangeEnabled: true,
  freshOidcAuth: false,
  ssoLinked: false,
  emailDeletion: true,
  sso: null,
};

const DEVICES: UserDeviceList = {
  devices: [{ deviceId: "device-1", name: "Ada's laptop", connected: true }],
};

const COMPUTER_PROVIDER: ComputerProviderSettings = {
  provider: "example-sandbox",
  defaultProvider: "example-sandbox",
  providers: [
    {
      id: "example-sandbox",
      displayName: "Example Sandbox",
      fields: [
        { key: "apiUrl", label: "API URL", kind: "url", required: true },
        { key: "apiKey", label: "API key", kind: "secret", required: true },
      ],
      capabilities: { perAccount: true },
    },
    {
      id: "sample-vm",
      displayName: "Sample VM",
      fields: [{ key: "region", label: "Region", kind: "text", required: false }],
      capabilities: { perAccount: false },
    },
  ],
  values: { apiUrl: "https://sandbox.example.test" },
  savedSecrets: { apiKey: true },
};

const computerApi = api({
  computerProvider: { get: COMPUTER_PROVIDER, account: { get: COMPUTER_PROVIDER } },
});

const UPDATE: DesktopUpdateState = {
  phase: "idle",
  currentVersion: "1.8.0",
  availableVersion: null,
  percent: null,
  message: null,
  checkedAt: NOW,
};

function desktopUpdates() {
  const state = async () => UPDATE;
  window.rakazoDesktop = {
    update: { state, check: state, download: state, install: state },
  } as LabradoodleDesktop;
  return () => {
    delete window.rakazoDesktop;
  };
}

const meta = {
  title: "Settings/Account settings",
  component: GeneralSettingsPanels,
  parameters: {
    layout: "padded",
    http: { "/api/auth/account-security": SECURITY, [USER_DEVICE_PATH]: DEVICES },
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  args: {
    name: ME.name,
    email: ME.email,
    timezone: "Europe/Berlin",
    onTimezoneChange: fn(async () => undefined),
    onNameSaved: fn(async () => undefined),
    onAccountImported: fn(async () => undefined),
    onImportAgent: fn(),
  },
} satisfies Meta<typeof GeneralSettingsPanels>;

export default meta;
type Story = StoryObj<typeof meta>;

export const General: Story = {};

export const EmailOnly: Story = { args: { name: "", timezone: null } };

export const Usage: Story = { render: () => <UsageSettingsPanel usage={USAGE} /> };

export const UsageEmpty: Story = {
  render: () => <UsageSettingsPanel usage={{ runs: 0, inputTokens: null, outputTokens: null }} />,
};

export const Computers: Story = {
  parameters: { api: computerApi },
  render: () => (
    <ComputerSettingsPanel
      sandboxProvider="example-sandbox"
      canConfigureComputers
      onSandboxProviderChange={fn()}
    />
  ),
};

export const ComputersUnavailable: Story = {
  parameters: { api: computerApi },
  render: () => <ComputerSettingsPanel sandboxProvider="none" onSandboxProviderChange={fn()} />,
};

export const Updates: Story = {
  beforeEach: desktopUpdates,
  render: () => (
    <DesktopUpdatesProvider>
      <UpdatesSettingsPanel />
    </DesktopUpdatesProvider>
  ),
};
