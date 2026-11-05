import type { BotSecretMetadata } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, screen } from "storybook/test";
import { api } from "../storybook/api";
import { NOW } from "../storybook/fixtures";
import { VaultSettings } from "./VaultSettings";

const item = (
  row: Partial<BotSecretMetadata> & Pick<BotSecretMetadata, "name" | "auth">,
): BotSecretMetadata => ({
  origin: "",
  title: row.name,
  note: "",
  createdAt: NOW,
  updatedAt: NOW,
  ...row,
});

const ITEMS: BotSecretMetadata[] = [
  item({
    name: "mail",
    title: "mail.example.test",
    origin: "https://mail.example.test",
    auth: { type: "login" },
    preview: { username: "ada@example.test" },
  }),
  item({
    name: "travel-card",
    title: "Travel card",
    note: "For flights and hotels",
    auth: { type: "card" },
    preview: {
      card: { brand: "Example", last4: "4242", expMonth: 8, expYear: 2030, billing: "home" },
    },
  }),
  item({
    name: "home",
    title: "Home",
    auth: { type: "contact" },
    preview: {
      contact: { name: "Ada Park", city: "Springfield", phone: "+1 555 0100" },
    },
  }),
  item({
    name: "reports-api",
    title: "reports.example.test",
    origin: "https://reports.example.test",
    auth: { type: "header", name: "X-Api-Key" },
  }),
  item({ name: "DEPLOY_TOKEN", auth: { type: "command" } }),
];

const MANY: BotSecretMetadata[] = [
  ...ITEMS,
  ...["shop", "wiki", "calendar", "storage"].map((name) =>
    item({
      name,
      title: `${name}.example.test`,
      origin: `https://${name}.example.test`,
      auth: { type: "login" },
      preview: { username: "ada@example.test" },
    }),
  ),
];

const meta = {
  title: "Settings/Vault",
  component: VaultSettings,
  parameters: {
    layout: "padded",
    api: api({
      vault: {
        list: ITEMS,
        put: ITEMS[0]!,
        remove: { ok: true },
        reveal: { value: "example-secret-value" },
      },
    }),
  },
  args: { scope: "account", onBusyChange: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof VaultSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};

export const Empty: Story = { parameters: { api: api({ vault: { list: [] } }) } };

export const ManyWithSearch: Story = { parameters: { api: api({ vault: { list: MANY } }) } };

export const ItemOpen: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByText("mail.example.test"));
  },
};

export const NewLogin: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /New/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Login" }));
  },
};

export const LoadError: Story = {
  parameters: {
    api: api({
      vault: {
        list: () => {
          throw new ORPCError("FORBIDDEN", { message: "Could not load credentials." });
        },
      },
    }),
  },
};
