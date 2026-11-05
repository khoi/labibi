import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { VaultItemEditor, VaultItemEditorPage } from "./VaultItemEditor";

const meta = {
  title: "Vault/Item editor",
  component: VaultItemEditor,
  args: {
    open: true,
    onOpenChange: fn(),
    kind: "login",
    mode: "new",
    heading: "New login",
    onSave: fn(async () => undefined),
    failureText: () => "Could not save. Try again.",
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof VaultItemEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewLogin: Story = {};

export const EditCard: Story = {
  args: {
    kind: "card",
    mode: "edit",
    heading: "Travel card",
    initial: {
      name: "travel-card",
      title: "Travel card",
      note: "For flights and hotels.",
      auth: { type: "card" },
      card: {
        number: "9000000000014242",
        expMonth: 8,
        expYear: 2029,
        cvc: "123",
        name: "Ada Park",
        billing: "home",
      },
    },
    contacts: [
      { name: "home", title: "Home" },
      { name: "office", title: "Office" },
    ],
  },
};

export const NewContact: Story = {
  args: {
    kind: "contact",
    heading: "New contact",
    initial: { contact: { name: "Ada Park", city: "Springfield", country: "Exampleland" } },
  },
};

export const ApiKey: Story = {
  args: {
    kind: "api_key",
    mode: "edit",
    heading: "Reports API",
    initial: {
      name: "reports-api",
      title: "Reports API",
      origin: "https://api.example.test",
      auth: { type: "header", name: "X-Api-Key" },
    },
  },
};

export const AskedInChat: Story = {
  args: {
    mode: "ask",
    heading: "Sign in to app.example.test",
    initial: {
      origin: "https://app.example.test",
      loginFields: [
        { label: "Email", value: "", hidden: false },
        { label: "Password", value: "", hidden: true },
      ],
      replacedSite: "old.example.test",
    },
    onDismiss: fn(async () => undefined),
  },
};

export const InSettings: Story = {
  render: () => (
    <div className="max-w-md p-4">
      <VaultItemEditorPage
        kind="variable"
        mode="edit"
        heading="Deploy token"
        initial={{ name: "deploy-token", title: "Deploy token", auth: { type: "command" } }}
        onBack={fn()}
        onSave={fn(async () => undefined)}
        failureText={() => "Could not save. Try again."}
      />
    </div>
  ),
};
