import type { ActionApprovalRule, ActionAutoReviewSettings } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../storybook/api";
import { NOW } from "../storybook/fixtures";
import { ApprovalRulesSettings } from "./ApprovalRulesSettings";

const ASK: ActionAutoReviewSettings = {
  mode: "ask",
  enabled: false,
  checkerAvailable: true,
  skipApprovals: false,
};

const rule = (
  id: string,
  matchKind: ActionApprovalRule["matchKind"],
  matchValue: string,
  effect: ActionApprovalRule["effect"],
): ActionApprovalRule => ({ id, matchKind, matchValue, effect, createdAt: NOW });

const RULES = [
  rule("rule-1", "tool", "MAIL_SEND_EMAIL", "require_approval"),
  rule("rule-2", "tool", "CALENDAR_CREATE_EVENT", "always_allow"),
  rule("rule-3", "site", "shop.example.test", "deny"),
  rule("rule-4", "category", "payments", "require_approval"),
];

const meta = {
  title: "Settings/Approval rules",
  component: ApprovalRulesSettings,
  parameters: {
    layout: "padded",
    api: api({
      approvalRules: {
        list: [],
        set: (input) => ({ ...input, id: `rule-${input.matchValue}`, createdAt: NOW }),
        remove: { ok: true },
      },
      autoReview: { get: ASK, set: (input) => ({ ...ASK, mode: input.mode ?? ASK.mode }) },
    }),
  },
  args: { scope: "account" },
} satisfies Meta<typeof ApprovalRulesSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithRules: Story = {
  parameters: { api: api({ approvalRules: { list: RULES } }) },
};

export const AutoReview: Story = {
  parameters: {
    api: api({
      approvalRules: { list: RULES.slice(0, 2) },
      autoReview: { get: { ...ASK, mode: "auto", enabled: true } },
    }),
  },
};

export const AutoWithoutModel: Story = {
  parameters: {
    api: api({
      autoReview: { get: { ...ASK, mode: "auto", enabled: true, checkerAvailable: false } },
    }),
  },
};

export const Loading: Story = {
  parameters: { api: api({ approvalRules: { list: () => new Promise(() => {}) } }) },
};

export const LoadError: Story = {
  parameters: {
    api: api({
      approvalRules: {
        list: () => {
          throw new ORPCError("FORBIDDEN", { message: "Could not load approval rules" });
        },
      },
    }),
  },
};
