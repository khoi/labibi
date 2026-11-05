import type { ActionApprovalRule, ActionAutoReviewSettings } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../storybook/api";
import { NOW } from "../storybook/fixtures";
import { SpaceSettingOverrides } from "./SpaceSettingOverrides";

const autoReview: ActionAutoReviewSettings = {
  mode: "ask",
  enabled: false,
  checkerAvailable: true,
  skipApprovals: false,
};

const rules: ActionApprovalRule[] = [
  {
    id: "rule-1",
    effect: "require_approval",
    matchKind: "tool",
    matchValue: "send_email",
    createdAt: NOW,
  },
  {
    id: "rule-2",
    effect: "always_allow",
    matchKind: "category",
    matchValue: "calendar",
    createdAt: NOW,
  },
];

const meta = {
  title: "Settings/Space overrides",
  component: SpaceSettingOverrides,
  parameters: {
    layout: "padded",
    api: api({
      spaceSettings: {
        overrides: [],
        setOverride: (input) => (input.enabled ? [input.setting] : []),
      },
      approvalRules: { list: rules },
      autoReview: { get: autoReview },
    }),
  },
  args: { onClose: fn(), onBusyChange: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SpaceSettingOverrides>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaults: Story = {};

export const CustomizedApprovals: Story = {
  parameters: { api: api({ spaceSettings: { overrides: ["confirmations"] } }) },
};

export const LoadError: Story = {
  parameters: {
    api: api({
      spaceSettings: {
        overrides: () => {
          throw new ORPCError("FORBIDDEN", { message: "You can't customize this space" });
        },
      },
    }),
  },
};
