import type {
  AccountSecurity,
  ActionAutoReviewSettings,
  BillingStatus,
  ComputerProviderSettings,
  DesktopUpdateState,
  LabradoodleDesktop,
  ModelCatalogEntry,
  ModelCredential,
  ModelRoleView,
  SpaceMemoryConfig,
  SpaceNavigation,
  UsageSummary,
  UserDeviceList,
  VoiceCatalogEntry,
  VoiceCredential,
} from "@labradoodle/contracts";
import { USER_DEVICE_PATH } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useArgs } from "storybook/preview-api";
import { fn } from "storybook/test";
import { DesktopUpdatesProvider } from "../components/DesktopUpdates";
import { api } from "../storybook/api";
import { BOTS, GROUP, ME, NOW, SPACE } from "../storybook/fixtures";
import { SettingsOverlay } from "./SettingsOverlay";

const CATALOG: ModelCatalogEntry[] = [
  {
    provider: "example",
    providerName: "Example AI",
    id: "example-large",
    label: "Example Large",
    billing: "API key",
    auth: "api-key",
    reasoning: true,
    thinkingLevels: ["low", "medium", "high"],
  },
  {
    provider: "example",
    providerName: "Example AI",
    id: "example-small",
    label: "Example Small",
    billing: "API key",
    auth: "api-key",
  },
  {
    provider: "sample",
    providerName: "Sample Labs",
    id: "sample-pro",
    label: "Sample Pro",
    billing: "API key",
    auth: "api-key",
  },
];

const CREDENTIALS: ModelCredential[] = [
  {
    id: "cred-example",
    provider: "example",
    label: "Example AI",
    hasKey: true,
    isDefault: true,
    modelId: "example-large",
    authKind: "api_key",
  },
];

const MAIN_ROLE: ModelRoleView = {
  primary: { provider: "example", modelId: "example-large", thinkingLevel: "medium" },
  backups: [{ provider: "example", modelId: "example-small" }],
  deploymentPrimary: null,
};

const VOICE_CATALOG: VoiceCatalogEntry[] = [
  {
    id: "example-voice",
    name: "Example Voice",
    description: "Hosted speech and transcription.",
    transcribe: true,
  },
  { id: "sample-speech", name: "Sample Speech", description: "Hosted speech.", transcribe: false },
];

const VOICE_CREDENTIAL: VoiceCredential = {
  id: "voice-cred-1",
  provider: "example-voice",
  hasKey: true,
  isDefault: true,
  voiceId: "voice-calm",
  speechModel: "",
  transcribe: true,
  endpoint: "",
  ttsModel: "",
  sttModel: "",
};

const MEMORY: SpaceMemoryConfig = {
  provider: "supermemory",
  settings: { mode: "local", baseUrl: "https://memory.example.test" },
  defaultMemoryScope: "isolated",
  updatedAt: NOW,
};

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
      provider: "Sample Labs",
      model: "sample-pro",
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

const AUTO_REVIEW: ActionAutoReviewSettings = {
  mode: "ask",
  enabled: false,
  checkerAvailable: true,
  skipApprovals: false,
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
  ],
  values: { apiUrl: "https://sandbox.example.test" },
  savedSecrets: { apiKey: true },
};

const BILLING: BillingStatus = {
  access: true,
  canManage: true,
  trialAvailable: false,
  trialDays: 7,
  state: "active",
  price: { amount: 1200, currency: "usd", interval: "month", intervalCount: 1 },
  seats: 3,
  trialEndsAt: null,
  currentPeriodEndsAt: "2026-12-02T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  hasCustomer: true,
};

const NAVIGATION: SpaceNavigation = {
  current: {
    id: SPACE.id,
    name: SPACE.name,
    bots: BOTS,
    groups: [GROUP],
    externalConversations: [],
    botSections: [],
  },
  spaces: [SPACE],
};

const SUPPORT = { id: "space-2", name: "Support", canRename: true, canDelete: true, botCount: 3 };

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
  title: "Settings/Settings overlay",
  component: SettingsOverlay,
  parameters: {
    http: { "/api/auth/account-security": SECURITY, [USER_DEVICE_PATH]: DEVICES },
    api: api({
      spaces: { list: NAVIGATION },
      bots: { list: BOTS },
      models: {
        list: CATALOG,
        credentials: CREDENTIALS,
        role: (input) =>
          input.role === "main"
            ? MAIN_ROLE
            : { primary: null, backups: [], deploymentPrimary: null },
        forRole: CATALOG,
        setRole: (input) => ({ ...MAIN_ROLE, ...input }),
      },
      voice: {
        catalog: VOICE_CATALOG,
        credentials: [VOICE_CREDENTIAL],
        status: {
          configured: true,
          ready: true,
          transcribe: true,
          provider: "example-voice",
          voiceId: "voice-calm",
        },
        voices: [
          { id: "voice-calm", label: "Calm", description: "Warm and steady" },
          { id: "voice-bright", label: "Bright" },
        ],
      },
      memory: {
        list: [
          {
            id: "memory-1",
            scope: "user",
            botId: null,
            path: "MEMORY.md",
            content: "# Team notes\n\n- Weekly report goes out on Mondays.",
            revision: 1,
            updatedAt: NOW,
          },
        ],
      },
      approvalRules: { list: [] },
      autoReview: { get: AUTO_REVIEW },
      vault: { list: [] },
      computerProvider: { get: COMPUTER_PROVIDER, account: { get: COMPUTER_PROVIDER } },
      billing: { status: BILLING },
      paymentWallet: { status: { status: "disconnected" } },
      spaceSettings: { overrides: [] },
      messaging: {
        status: { enabled: true, providers: ["example-chat"], openSignup: false, identities: [] },
        channels: { list: [] },
        connections: { list: [] },
        installations: { list: { available: false, installations: [] } },
      },
    }),
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background">
        <Story />
      </div>
    ),
  ],
  args: {
    section: "general",
    name: ME.name,
    email: ME.email,
    timezone: "Europe/Berlin",
    memoryConfig: null,
    spaces: [{ id: SPACE.id, name: SPACE.name }],
    onSectionChange: fn(),
    onUsageOpen: fn(),
    onTimezoneChange: fn(async () => undefined),
    onMemoryConfigChange: fn(),
    onClose: fn(),
    onOpenSpace: fn(),
    onRenameSpace: fn(async () => undefined),
    onDeleteSpace: fn(async () => undefined),
  },
  render: function Render(args) {
    const [, updateArgs] = useArgs<typeof args>();
    return (
      <SettingsOverlay
        {...args}
        onSectionChange={(section) => {
          updateArgs({ section });
          args.onSectionChange(section);
        }}
        onOpenSpace={(spaceId) => {
          updateArgs({ section: "space" });
          args.onOpenSpace?.(spaceId);
        }}
        onMemoryConfigChange={(memoryConfig) => {
          updateArgs({ memoryConfig });
          args.onMemoryConfigChange(memoryConfig);
        }}
      />
    );
  },
} satisfies Meta<typeof SettingsOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const General: Story = {};

export const GeneralWithSpaces: Story = {
  args: { spaces: [{ id: SPACE.id, name: SPACE.name }, SUPPORT], space: SUPPORT },
};

export const Space: Story = {
  args: { section: "space", spaces: [{ id: SPACE.id, name: SPACE.name }, SUPPORT], space: SUPPORT },
};

export const Organization: Story = { args: { section: "organization" } };

export const Models: Story = { args: { section: "models" } };

export const Voice: Story = { args: { section: "voice" } };

export const Approvals: Story = { args: { section: "confirmations" } };

export const Vault: Story = { args: { section: "vault" } };

export const Messaging: Story = { args: { section: "messaging", messagingEnabled: true } };

export const Wallet: Story = {
  args: {
    section: "wallet",
    paymentWalletProvider: { id: "example-wallet", name: "Example Wallet" },
  },
};

export const Memory: Story = { args: { section: "memory", memoryConfig: MEMORY } };

export const Usage: Story = { args: { section: "usage", usage: USAGE } };

export const Computer: Story = {
  args: { section: "computer", sandboxProvider: "example-sandbox", canConfigureComputers: true },
};

export const Billing: Story = { args: { section: "billing", billingEnabled: true } };

export const Updates: Story = {
  args: { section: "updates" },
  beforeEach: desktopUpdates,
  decorators: [
    (Story) => (
      <DesktopUpdatesProvider>
        <Story />
      </DesktopUpdatesProvider>
    ),
  ],
};
