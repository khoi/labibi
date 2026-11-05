import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { WithPageDocument } from "../../storybook/pages";
import { PageNotice } from "./PageNotice";
import { PageView } from "./PageView";
import { SharePopover } from "./SharePopover";

const share = (compact: boolean) => (
  <SharePopover
    title="Q3 launch tracker"
    owner={{ name: "Ada Park", image: null }}
    visibility="private"
    shareUrl={null}
    onVisibilityChange={fn()}
    compact={compact}
  />
);

const meta = {
  title: "Pages/Page view",
  component: PageView,
  decorators: [
    (Story) => (
      <>
        <div className="h-dvh bg-background" />
        <Story />
      </>
    ),
  ],
  args: {
    open: true,
    onOpenChange: fn(),
    title: "Q3 launch tracker",
    document: null,
    onRename: fn(),
    onReply: fn(),
    share: share(false),
  },
  render: (args) => (
    <WithPageDocument>{(document) => <PageView {...args} document={document} />}</WithPageDocument>
  ),
} satisfies Meta<typeof PageView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};

export const Loading: Story = { render: (args) => <PageView {...args} /> };

export const RenameFailed: Story = {
  args: { renameError: "Could not rename this page. Try again." },
};

export const Unavailable: Story = {
  args: {
    notice: (
      <PageNotice
        title="This page isn't available"
        detail="It may have been deleted, or it belongs to someone else."
        onClose={fn()}
      />
    ),
  },
};

export const Touch: Story = { args: { compact: true, share: share(true) } };
