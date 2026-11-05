import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../storybook/api";
import { SpendingLimitSettings } from "./SpendingLimitSettings";

const meta = {
  title: "Settings/Spending limit",
  component: SpendingLimitSettings,
  parameters: {
    layout: "padded",
    api: api({ spendingLimit: { get: { limit: null, spent: 0, shown: true } } }),
  },
} satisfies Meta<typeof SpendingLimitSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoLimit: Story = {};

export const MonthlyLimit: Story = {
  parameters: {
    api: api({
      spendingLimit: {
        get: {
          limit: { amount: 50_00, currency: "usd", period: "month" },
          spent: 18_40,
          shown: true,
        },
      },
    }),
  },
};

export const NearlySpent: Story = {
  parameters: {
    api: api({
      spendingLimit: {
        get: {
          limit: { amount: 20_00, currency: "eur", period: "week" },
          spent: 19_10,
          shown: true,
        },
      },
    }),
  },
};

export const SaveFails: Story = {
  parameters: {
    api: api({
      spendingLimit: {
        set: () => {
          throw new ORPCError("BAD_REQUEST", { message: "That limit is too high." });
        },
      },
    }),
  },
};
