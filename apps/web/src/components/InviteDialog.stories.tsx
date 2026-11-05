import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { InviteDialog } from "./InviteDialog";

const meta = {
  title: "Account/Invite friends",
  component: InviteDialog,
  args: {
    open: true,
    onOpenChange: fn(),
    referral: { url: "https://app.example.test/invite/ADA-7Q2K", rewards: 0 },
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InviteDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoRewardsYet: Story = {};

export const RewardsEarned: Story = {
  args: { referral: { url: "https://app.example.test/invite/ADA-7Q2K", rewards: 3 } },
};
