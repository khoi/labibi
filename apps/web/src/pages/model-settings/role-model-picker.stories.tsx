import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type { ConnectableProvider, RoleModelOption } from "./role-model-picker";
import { RoleModelPicker } from "./role-model-picker";

const OPTIONS: RoleModelOption[] = [
  {
    provider: "example",
    providerName: "Example AI",
    id: "example-large",
    label: "Example Large",
    billing: "",
    credentialId: "cred-example",
  },
  {
    provider: "example",
    providerName: "Example AI",
    id: "example-small",
    label: "Example Small",
    billing: "",
    credentialId: "cred-example",
  },
  {
    provider: "sample",
    providerName: "Sample Labs",
    id: "sample-pro",
    label: "Sample Pro",
    billing: "",
    credentialId: "cred-sample",
  },
];

const PROVIDERS: ConnectableProvider[] = [
  { id: "demo", name: "Demo Cloud" },
  { id: "test-models", name: "Test Models" },
];

const MANY: RoleModelOption[] = Array.from({ length: 14 }, (_, index) => ({
  provider: "example",
  providerName: "Example AI",
  id: `example-${index + 1}`,
  label: `Example model ${index + 1}`,
  billing: "",
}));

const meta = {
  title: "Settings/Model settings/Role model picker",
  component: RoleModelPicker,
  parameters: { layout: "padded" },
  args: {
    trigger: (
      <button type="button" className="text-[15px] text-foreground">
        Example Large
      </button>
    ),
    label: "Change Main model",
    options: OPTIONS,
    providers: PROVIDERS,
    reopen: { query: "", key: 1 },
    onPick: fn(),
    onConnect: fn(),
    onReopened: fn(),
  },
} satisfies Meta<typeof RoleModelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};

export const WithDeploymentDefault: Story = { args: { defaultOption: "Example Medium" } };

export const OnlyProvidersToConnect: Story = { args: { options: [] } };

export const ManyModels: Story = { args: { options: MANY, providers: [] } };

export const Searching: Story = { args: { options: MANY, reopen: { query: "model 1", key: 1 } } };

export const Closed: Story = { args: { reopen: undefined } };
