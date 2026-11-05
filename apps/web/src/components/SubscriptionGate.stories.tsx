import type { AuthCapabilities, BillingStatus } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../storybook/api";
import { ME } from "../storybook/fixtures";
import { SubscriptionGate } from "./SubscriptionGate";

const BILLED: AuthCapabilities = {
  sso: null,
  passwordAuth: true,
  passwordReset: true,
  resetUrl: null,
  emailCode: true,
  passkeyRpId: null,
  billing: true,
};

const NEW_ACCOUNT: BillingStatus = {
  funding: null,
  byokPriceCents: 2000,
  byokAnnualPriceCents: 20000,
  byokInterval: "month",
  byokFreeUntil: null,
  creditPurchasesEnabled: true,
  access: false,
  canManage: true,
  trialAvailable: true,
  trialDays: 7,
  state: "none",
  price: null,
  seats: 1,
  trialEndsAt: null,
  currentPeriodEndsAt: null,
  cancelAtPeriodEnd: false,
  hasCustomer: false,
};

const SUBSCRIBED: BillingStatus = {
  ...NEW_ACCOUNT,
  funding: "byok",
  access: true,
  trialAvailable: false,
  state: "active",
  price: { amount: 2000, currency: "usd", interval: "month", intervalCount: 1 },
  currentPeriodEndsAt: "2026-11-26T00:00:00.000Z",
  hasCustomer: true,
};

const billed = (status: BillingStatus | (() => Promise<BillingStatus>)) => ({
  http: { "/api/auth/capabilities": BILLED },
  api: api({ me: { ...ME, billingEnabled: true }, billing: { status } }),
});

const meta = {
  title: "Account/Subscription gate",
  component: SubscriptionGate,
  args: {
    children: (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">App</div>
    ),
    fallback: (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Loading
      </div>
    ),
  },
} satisfies Meta<typeof SubscriptionGate>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotBilled: Story = {};

export const Checking: Story = {
  parameters: billed(() => new Promise(() => {})),
};

export const Paywall: Story = {
  parameters: billed(NEW_ACCOUNT),
};

export const PlansOpen: Story = {
  parameters: { ...billed(SUBSCRIBED), route: "/?plans" },
};
