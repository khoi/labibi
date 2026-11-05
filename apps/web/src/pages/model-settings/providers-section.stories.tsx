import type { ModelCredential } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, userEvent, within } from "storybook/test";
import { api } from "../../storybook/api";
import { ConnectionNameField, ProvidersSection } from "./providers-section";
import type { ConnectableProvider } from "./role-model-picker";

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
    id: "cred-example-work",
    provider: "example",
    label: "Example AI (Work)",
    hasKey: true,
    isDefault: false,
    modelId: "example-small",
  },
  {
    id: "cred-sample",
    provider: "sample",
    label: "Sample Labs",
    hasKey: false,
    isDefault: false,
    authKind: "oauth",
    reconnectRequired: true,
  },
];

const PROVIDERS: ConnectableProvider[] = [
  { id: "example", name: "Example AI" },
  { id: "sample", name: "Sample Labs" },
  { id: "demo", name: "Demo Cloud" },
  { id: "test-models", name: "Test Models" },
];

const panel = (
  <div className="rounded-xl border border-border px-4 py-4 text-[13.5px] text-muted-foreground">
    Connection form
  </div>
);

const meta = {
  title: "Settings/Model settings/Providers section",
  component: ProvidersSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
  args: {
    credentials: CREDENTIALS,
    providers: PROVIDERS,
    name: (credential) => credential.label,
    onAdd: fn(),
    onOpen: fn(),
  },
} satisfies Meta<typeof ProvidersSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Connected: Story = {};

export const Empty: Story = { args: { credentials: [] } };

export const ConnectionOpen: Story = { args: { panel, panelAt: "cred-example" } };

export const AddingProvider: Story = { args: { panel, panelAt: "add" } };

export const AddProviderMenu: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Add provider" }));
  },
};

export const RenameConnection: Story = {
  parameters: { api: api({ models: { rename: { ok: true } } }) },
  render: () => <ConnectionNameField credential={CREDENTIALS[0]!} onRenamed={fn()} />,
  play: async ({ canvasElement }) => {
    const name = within(canvasElement).getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Example AI (Personal)");
  },
};

export const RenameFailed: Story = {
  parameters: {
    api: api({
      models: {
        rename: () => {
          throw new ORPCError("BAD_REQUEST", { message: "That name is already in use." });
        },
      },
    }),
  },
  render: () => <ConnectionNameField credential={CREDENTIALS[0]!} onRenamed={fn()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const name = canvas.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Example AI (Work)");
    await userEvent.click(canvas.getByRole("button", { name: "Save" }));
  },
};
