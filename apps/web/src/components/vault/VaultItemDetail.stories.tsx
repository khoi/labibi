import type { BotSecretMetadata, VaultRevealed } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { NOW } from "../../storybook/fixtures";
import { VaultItemDetail } from "./VaultItemDetail";

const item = (overrides: Partial<BotSecretMetadata>): BotSecretMetadata => ({
  name: "example-login",
  origin: "https://app.example.test",
  auth: { type: "login" },
  title: "app.example.test",
  note: "",
  preview: { username: "ada@example.test" },
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const LOGIN = item({ note: "Use for the weekly report export." });

const REVEALED: VaultRevealed = {
  fields: [
    { label: "Email", value: "ada@example.test", hidden: false },
    { label: "Password", value: "correct-horse-battery", hidden: true },
  ],
};

const meta = {
  title: "Vault/Item detail",
  component: VaultItemDetail,
  parameters: { layout: "padded" },
  args: {
    item: LOGIN,
    contactTitles: new Map([["home", "Home"]]),
    busy: false,
    error: null,
    onClose: fn(),
    onReveal: fn(async (): Promise<VaultRevealed | null> => REVEALED),
    onEdit: fn(),
    onRemove: fn(async () => true),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof VaultItemDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Login: Story = {};

export const LoginRevealed: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Show" }));
    await canvas.findByText("correct-horse-battery");
  },
};

export const Card: Story = {
  args: {
    item: item({
      name: "travel-card",
      origin: "",
      auth: { type: "card" },
      title: "Travel card",
      note: "For flights and hotels.",
      preview: {
        card: {
          brand: "Card",
          last4: "4242",
          expMonth: 8,
          expYear: 2029,
          name: "Ada Park",
          billing: "home",
        },
      },
    }),
    onReveal: fn(
      async (): Promise<VaultRevealed | null> => ({
        card: {
          number: "9000000000014242",
          expMonth: 8,
          expYear: 2029,
          cvc: "123",
          name: "Ada Park",
        },
      }),
    ),
  },
};

export const Contact: Story = {
  args: {
    item: item({
      name: "home",
      origin: "",
      auth: { type: "contact" },
      title: "Home",
      preview: {
        contact: {
          name: "Ada Park",
          line1: "1 Example Street",
          line2: "Apartment 4",
          city: "Springfield",
          region: "EX",
          postalCode: "12345",
          country: "Exampleland",
          phone: "+1 555 0100",
          email: "ada@example.test",
        },
      },
    }),
  },
};

export const ApiKey: Story = {
  args: {
    item: item({
      name: "reports-api",
      origin: "https://api.example.test",
      auth: { type: "header", name: "X-Api-Key" },
      title: "Reports API",
      preview: undefined,
    }),
    onReveal: fn(async (): Promise<VaultRevealed | null> => ({ value: "example-key-1234567890" })),
  },
};

export const Unreadable: Story = {
  args: { item: item({ name: "Old Item", auth: null, title: "Old item", preview: undefined }) },
};

export const ConfirmRemove: Story = {
  args: { error: "Could not remove. Try again." },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Remove" }));
  },
};
