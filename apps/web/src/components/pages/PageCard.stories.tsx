import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { WithPageDocument } from "../../storybook/pages";
import { PageCard } from "./PageCard";

const meta = {
  title: "Pages/Page card",
  component: PageCard,
  parameters: { layout: "padded" },
  args: {
    title: "Q3 launch tracker",
    document: null,
    updatedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    onOpen: fn(),
  },
  render: (args) => (
    <WithPageDocument>{(document) => <PageCard {...args} document={document} />}</WithPageDocument>
  ),
} satisfies Meta<typeof PageCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Shared: Story = { args: { shared: true } };

export const UpdatedBelow: Story = { args: { updated: true } };

export const Loading: Story = { render: (args) => <PageCard {...args} /> };

export const CouldNotLoad: Story = {
  args: { failed: true },
  render: (args) => <PageCard {...args} />,
};

export const Deleted: Story = { args: { onOpen: undefined } };
