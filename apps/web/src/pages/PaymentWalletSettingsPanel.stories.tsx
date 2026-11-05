import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../storybook/api";
import { PaymentWalletSettingsPanel } from "./PaymentWalletSettingsPanel";

const meta = {
  title: "Settings/Payment wallet",
  component: PaymentWalletSettingsPanel,
  parameters: {
    layout: "padded",
    api: api({ paymentWallet: { status: { status: "disconnected" } } }),
  },
  args: { provider: { id: "example-wallet", name: "Example Wallet" } },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PaymentWalletSettingsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Disconnected: Story = {};

export const Connecting: Story = {
  parameters: {
    api: api({
      paymentWallet: {
        status: {
          status: "connecting",
          verificationUrl: "https://wallet.example.test/connect/abc",
          userCode: "WXYZ-1234",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      },
    }),
  },
};

export const Connected: Story = {
  parameters: {
    api: api({
      paymentWallet: { status: { status: "connected", connectedAt: "2026-10-27T12:01:00.000Z" } },
    }),
  },
};

export const LoadError: Story = {
  parameters: {
    api: api({
      paymentWallet: {
        status: () => {
          throw new ORPCError("FORBIDDEN", { message: "Wallets are not available here" });
        },
      },
    }),
  },
};
