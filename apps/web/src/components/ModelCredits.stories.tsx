import type { BillingStatus } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";
import { rpc } from "../lib/rpc";
import { CreditChoice, ModelCreditsSettings } from "./ModelCredits";

const TIERS: NonNullable<BillingStatus["byokTiers"]> = [
  {
    tier: "standard",
    name: "Standard",
    monthlyPriceCents: 2000,
    annualPriceCents: 20000,
    computerSize: "standard",
    computerHours: 50,
  },
  {
    tier: "pro",
    name: "Pro",
    monthlyPriceCents: 5000,
    annualPriceCents: 50000,
    computerSize: "large",
    computerHours: 100,
  },
  {
    tier: "max",
    name: "Max",
    monthlyPriceCents: 10000,
    annualPriceCents: 100000,
    computerSize: "xlarge",
    computerHours: 200,
  },
];

const CREDITS: BillingStatus = {
  funding: "credits",
  balanceUsd: 18.42,
  monthlyAmountCents: 3000,
  creditPurchasesEnabled: true,
  byokPriceCents: 2000,
  byokAnnualPriceCents: 20000,
  byokInterval: "month",
  byokTier: "standard",
  byokTiers: TIERS,
  byokFreeUntil: null,
  access: true,
  canManage: true,
  trialAvailable: false,
  trialDays: 7,
  state: "active",
  price: { amount: 3000, currency: "usd", interval: "month", intervalCount: 1 },
  seats: 1,
  trialEndsAt: null,
  currentPeriodEndsAt: "2026-11-26T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  hasCustomer: true,
  computerHoursLeft: null,
};

const OWN_KEY: BillingStatus = {
  ...CREDITS,
  funding: "byok",
  balanceUsd: 0,
  monthlyAmountCents: null,
  price: { amount: 2000, currency: "usd", interval: "month", intervalCount: 1 },
  computerHoursLeft: 42,
};

type Args = Omit<ComponentProps<typeof ModelCreditsSettings>, "client">;

const meta = {
  title: "Settings/Model credits",
  parameters: { layout: "padded" },
  args: { status: CREDITS, refresh: fn(async () => {}) },
  render: (args) => (
    <div className="max-w-xl">
      <ModelCreditsSettings {...args} client={rpc} />
    </div>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Credits: Story = {};

export const OwnKeyPlan: Story = { args: { status: OWN_KEY } };

export const Trial: Story = {
  args: {
    status: {
      ...OWN_KEY,
      state: "trialing",
      trialEndsAt: "2026-11-02T00:00:00.000Z",
      currentPeriodEndsAt: "2026-11-02T00:00:00.000Z",
      computerHoursLeft: 4,
    },
  },
};

export const FreePeriod: Story = {
  args: {
    status: {
      ...OWN_KEY,
      state: "none",
      price: null,
      byokFreeUntil: "2026-12-01T00:00:00.000Z",
      hasCustomer: false,
      currentPeriodEndsAt: null,
      computerHoursLeft: null,
    },
  },
};

export const PastDue: Story = {
  args: { status: { ...CREDITS, state: "past_due", balanceUsd: 0 } },
};

export const ViewOnly: Story = {
  args: { status: { ...CREDITS, canManage: false } },
};

export const Paywall: Story = {
  parameters: { layout: "fullscreen" },
  render: () => (
    <CreditChoice
      status={{
        ...CREDITS,
        funding: null,
        balanceUsd: 0,
        monthlyAmountCents: null,
        state: "none",
        price: null,
        trialAvailable: true,
        hasCustomer: false,
        currentPeriodEndsAt: null,
      }}
    />
  ),
};
