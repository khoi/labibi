import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { PageLoading, PageNotice } from "./PageNotice";

const meta = {
  title: "Pages/Page notice",
  component: PageNotice,
  args: {
    title: "This page couldn't load",
    detail: "Check your connection and try again.",
    onRetry: fn(),
    onClose: fn(),
  },
  decorators: [
    (Story) => (
      <div className="relative h-dvh bg-card">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PageNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CouldNotLoad: Story = {};

export const NotAvailable: Story = {
  args: {
    title: "This page isn't available",
    detail: "It may have been deleted, or it belongs to someone else.",
    onRetry: undefined,
  },
};

export const Loading: Story = { render: () => <PageLoading /> };
