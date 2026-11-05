import type { BillingStatus } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PaywallPage } from "./Paywall";

const SUBSCRIPTION: BillingStatus = {
  access: false,
  canManage: true,
  trialAvailable: true,
  trialDays: 14,
  state: "none",
  price: { amount: 2_000, currency: "usd", interval: "month", intervalCount: 1 },
  seats: 1,
  trialEndsAt: null,
  currentPeriodEndsAt: null,
  cancelAtPeriodEnd: false,
  hasCustomer: false,
};

const meta = {
  title: "Views/Paywall",
  component: PaywallPage,
  args: { status: SUBSCRIPTION, dismissible: false },
} satisfies Meta<typeof PaywallPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StartTrial: Story = {};

export const PastDue: Story = {
  args: {
    status: { ...SUBSCRIPTION, state: "past_due", trialAvailable: false, hasCustomer: true },
  },
};

export const Unpaid: Story = {
  args: { status: { ...SUBSCRIPTION, state: "unpaid", trialAvailable: false, hasCustomer: true } },
};

export const MemberWaiting: Story = {
  args: { status: { ...SUBSCRIPTION, canManage: false } },
};

export const CreditChoice: Story = {
  args: {
    status: {
      ...SUBSCRIPTION,
      funding: null,
      balanceUsd: 0,
      creditPurchasesEnabled: true,
      byokPriceCents: 900,
      byokAnnualPriceCents: 9_000,
    },
  },
};

export const CreditChoiceFreeOwnKey: Story = {
  args: {
    dismissible: true,
    status: {
      ...SUBSCRIPTION,
      funding: null,
      balanceUsd: 0,
      creditPurchasesEnabled: true,
      byokPriceCents: null,
    },
  },
};
