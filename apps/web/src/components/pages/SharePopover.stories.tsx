import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ManualCopy, SharePopover } from "./SharePopover";

const SHARE_URL = "https://labradoodle.example.test/p/q3-launch-tracker";

const meta = {
  title: "Pages/Share popover",
  component: SharePopover,
  parameters: { layout: "centered" },
  args: {
    title: "Q3 launch tracker",
    owner: { name: "Ada Park", image: null },
    visibility: "private",
    shareUrl: null,
    open: true,
    onOpenChange: fn(),
    onVisibilityChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className="flex h-[360px] w-[420px] items-start justify-end">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SharePopover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnlyYou: Story = {};

export const AnyoneWithLink: Story = { args: { visibility: "link", shareUrl: SHARE_URL } };

export const Saving: Story = { args: { visibility: "link", shareUrl: null, pending: true } };

export const ChangeFailed: Story = {
  args: { error: "Could not change who can view this page. Try again." },
};

export const Touch: Story = {
  args: { visibility: "link", shareUrl: SHARE_URL, compact: true },
};

export const CopyFallback: Story = {
  render: () => (
    <div className="w-[360px]">
      <ManualCopy url={SHARE_URL} />
    </div>
  ),
};
