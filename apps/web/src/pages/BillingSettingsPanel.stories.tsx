import type { BillingStatus } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../storybook/api";
import { BillingSettingsPanel } from "./BillingSettingsPanel";

const seatPlan: BillingStatus = {
  access: true,
  canManage: true,
  trialAvailable: false,
  trialDays: 7,
  state: "active",
  price: { amount: 1200, currency: "usd", interval: "month", intervalCount: 1 },
  seats: 3,
  trialEndsAt: null,
  currentPeriodEndsAt: "2026-12-02T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  hasCustomer: true,
};

const tiers: NonNullable<BillingStatus["byokTiers"]> = [
  {
    tier: "standard",
    name: "Standard",
    monthlyPriceCents: 2000,
    annualPriceCents: 19200,
    computerSize: "standard",
    computerHours: 40,
  },
  {
    tier: "pro",
    name: "Pro",
    monthlyPriceCents: 6000,
    annualPriceCents: 57600,
    computerSize: "large",
    computerHours: 160,
  },
];

const billing = (status: BillingStatus) => api({ billing: { status } });

const meta = {
  title: "Settings/Billing",
  component: BillingSettingsPanel,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BillingSettingsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Trial: Story = {
  parameters: {
    api: billing({
      ...seatPlan,
      state: "trialing",
      trialEndsAt: "2026-11-12T00:00:00.000Z",
    }),
  },
};

export const Active: Story = { parameters: { api: billing(seatPlan) } };

export const PastDue: Story = {
  parameters: { api: billing({ ...seatPlan, state: "past_due", seats: 1 }) },
};

export const Credits: Story = {
  parameters: {
    api: billing({
      ...seatPlan,
      funding: "credits",
      balanceUsd: 18.4,
      monthlyAmountCents: 3000,
      creditPurchasesEnabled: true,
      price: null,
    }),
  },
};

export const OwnKeyTrial: Story = {
  parameters: {
    api: billing({
      ...seatPlan,
      funding: "byok",
      state: "trialing",
      trialEndsAt: "2026-11-12T00:00:00.000Z",
      balanceUsd: 0,
      monthlyAmountCents: null,
      creditPurchasesEnabled: true,
      byokPriceCents: 2000,
      byokAnnualPriceCents: 19200,
      byokInterval: "month",
      byokTier: "standard",
      byokTiers: tiers,
      computerHoursLeft: 12,
      price: null,
    }),
  },
};

export const Loading: Story = {
  parameters: { api: api({ billing: { status: () => new Promise(() => {}) } }) },
};

export const LoadError: Story = {
  parameters: {
    api: api({
      billing: {
        status: () => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Billing is unavailable" });
        },
      },
    }),
  },
};
