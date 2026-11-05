import type { ModelCatalogEntry, ModelCredential, ModelRoleView } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../storybook/api";
import { SPACE_ID, USER_ID } from "../storybook/fixtures";
import { ModelRoleSettings } from "./ModelRoleSettings";

const CATALOG: ModelCatalogEntry[] = [
  {
    provider: "example",
    providerName: "Example AI",
    id: "example-large",
    label: "Example Large",
    billing: "",
    reasoning: true,
    thinkingLevels: ["low", "medium", "high"],
  },
  {
    provider: "example",
    providerName: "Example AI",
    id: "example-small",
    label: "Example Small",
    billing: "",
  },
  {
    provider: "sample",
    providerName: "Sample Labs",
    id: "sample-pro",
    label: "Sample Pro",
    billing: "",
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
  },
  {
    id: "cred-sample",
    provider: "sample",
    label: "Sample Labs",
    hasKey: true,
    isDefault: false,
    modelId: "sample-pro",
  },
];

const EMPTY: ModelRoleView = { primary: null, backups: [], deploymentPrimary: null };

const WITH_FALLBACKS: ModelRoleView = {
  primary: { provider: "example", modelId: "example-large", thinkingLevel: "high" },
  backups: [
    { provider: "example", modelId: "example-small" },
    { provider: "sample", modelId: "sample-pro" },
  ],
  deploymentPrimary: null,
};

const PROVIDER_NAMES: Record<string, string> = { example: "Example AI", sample: "Sample Labs" };

function roleApi(settings: ModelRoleView) {
  return api({
    models: {
      role: settings,
      forRole: CATALOG,
      setRole: ({ primary, backups }) => ({
        ...settings,
        ...(primary === undefined ? {} : { primary }),
        ...(backups ? { backups } : {}),
      }),
    },
  });
}

const meta = {
  title: "Settings/Model role settings",
  component: ModelRoleSettings,
  parameters: { layout: "padded", api: roleApi(WITH_FALLBACKS) },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
  args: {
    userId: USER_ID,
    spaceId: SPACE_ID,
    scope: "account",
    credentials: CREDENTIALS,
    title: "Main model",
    defaultLabel: "Choose a model",
    providers: [{ id: "demo", name: "Demo Cloud" }],
    providerLabel: (provider) => PROVIDER_NAMES[provider] ?? provider,
    thinking: true,
    onConnect: fn(),
    onManage: fn(),
    onChanged: fn(),
  },
} satisfies Meta<typeof ModelRoleSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithFallbacks: Story = {};

export const NothingChosen: Story = { parameters: { api: roleApi(EMPTY) } };

export const DeploymentDefault: Story = {
  args: { modelRole: "approval", title: "Approval model", thinking: false },
  parameters: {
    api: roleApi({
      ...EMPTY,
      deploymentPrimary: { provider: "example", modelId: "example-small" },
    }),
  },
};

export const WithConnectionForm: Story = {
  args: {
    panel: (
      <div className="mt-3 rounded-xl border border-border px-4 py-4 text-[13.5px] text-muted-foreground">
        Connection form
      </div>
    ),
  },
};

export const Loading: Story = {
  parameters: { api: api({ models: { role: () => new Promise(() => {}) } }) },
};

export const LoadFailed: Story = {
  parameters: {
    api: api({
      models: {
        role: () => {
          throw new ORPCError("BAD_REQUEST", { message: "Could not load models" });
        },
      },
    }),
  },
};
