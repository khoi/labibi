import type { ModelCatalogEntry, ModelCredential, ModelRoleView } from "@labradoodle/contracts";
import { OPENAI_COMPATIBLE_PROVIDER_ID } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { api } from "../storybook/api";
import { BOTS, CHIEF, ME } from "../storybook/fixtures";
import { ModelSettingsOverlay } from "./ModelSettingsOverlay";

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
    billing: "Sign in or paste a key",
    auth: "both",
    subscription: true,
    signIn: "device-code",
    oauthLabel: "Sign in with Sample Labs",
  },
  {
    provider: "demo",
    providerName: "Demo Cloud",
    id: "demo-chat",
    label: "Demo Chat",
    billing: "API key",
    auth: "api-key",
  },
  {
    provider: OPENAI_COMPATIBLE_PROVIDER_ID,
    providerName: "Custom server",
    id: "custom",
    label: "Custom model",
    billing: "Your server",
    auth: "api-key",
    placeholder: true,
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
  {
    id: "cred-local",
    provider: OPENAI_COMPATIBLE_PROVIDER_ID,
    label: "Local server",
    hasKey: false,
    isDefault: false,
    baseUrl: "http://127.0.0.1:8000/v1",
    modelId: "example-local",
    enabledModelIds: ["example-local", "example-local-mini"],
    authKind: "openai_compatible",
  },
];

const ROLE: ModelRoleView = {
  primary: { provider: "example", modelId: "example-large", thinkingLevel: "medium" },
  backups: [{ provider: "example", modelId: "example-small" }],
  deploymentPrimary: null,
};

const EMPTY_ROLE: ModelRoleView = { primary: null, backups: [], deploymentPrimary: null };

function modelsApi({
  credentials = CREDENTIALS,
  role = ROLE,
  me = ME,
}: {
  credentials?: ModelCredential[];
  role?: ModelRoleView;
  me?: typeof ME;
} = {}) {
  return api({
    me,
    bots: {
      list: [{ ...CHIEF, modelProvider: "example", modelId: "example-small" }, ...BOTS.slice(1)],
    },
    models: {
      list: CATALOG,
      credentials,
      role: (input) => (input.role === "main" ? role : EMPTY_ROLE),
      forRole: CATALOG,
      setRole: (input) => ({ ...role, ...input }),
      rename: { ok: true },
      probeOpenAiCompatible: {
        models: ["example-local", "example-local-mini", "example-local-coder"],
      },
    },
  });
}

const meta = {
  title: "Settings/Models",
  component: ModelSettingsOverlay,
  parameters: { api: modelsApi() },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background">
        <Story />
      </div>
    ),
  ],
  args: { scope: "account", onClose: fn() },
} satisfies Meta<typeof ModelSettingsOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Configured: Story = {};

export const NoModelYet: Story = {
  parameters: {
    api: modelsApi({ credentials: [], role: EMPTY_ROLE, me: { ...ME, needsModel: true } }),
  },
};

export const ConnectionOpen: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole("button", { name: "Example AI" }));
  },
};

export const CompatibleServerOpen: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole("button", { name: /Local server/ }));
  },
};

export const SpaceScope: Story = { args: { scope: "space" } };

export const Loading: Story = {
  parameters: {
    api: api({ me: () => new Promise(() => {}), models: { list: () => new Promise(() => {}) } }),
  },
};

export const LoadFailed: Story = {
  parameters: {
    api: api({
      models: {
        credentials: () => {
          throw new ORPCError("BAD_REQUEST", { message: "Model settings are unavailable." });
        },
      },
    }),
  },
};
