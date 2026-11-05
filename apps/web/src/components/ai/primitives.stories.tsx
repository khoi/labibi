import { Spinner } from "@labradoodle/ui-web";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { BuiCard, LoadingState, Shimmer, SuccessPop } from "./primitives";

const meta = {
  title: "Primitives/AI loading",
  component: LoadingState,
  parameters: { layout: "centered" },
  args: { label: "Working" },
} satisfies Meta<typeof LoadingState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const StartedEarlier: Story = {
  args: { label: "Reconnecting", startedAt: Date.now() - 83_000 },
};

export const CustomIndicator: Story = {
  args: { label: "Updating", indicator: <Spinner className="size-4 text-muted-foreground" /> },
};

export const ShimmerText: Story = {
  name: "Shimmer",
  render: (args) => (
    <span className="text-[15px]">
      <Shimmer>{args.label}</Shimmer>
    </span>
  ),
};

export const Success: Story = {
  args: { label: "Saved" },
  render: (args) => <SuccessPop label={args.label ?? ""} />,
};

export const Card: Story = {
  render: () => (
    <BuiCard className="w-80 px-5 py-4 text-foreground">
      <p className="text-[15px] font-medium">Quarterly summary</p>
      <p className="mt-1 text-sm text-muted-foreground">Ready for review on Monday.</p>
    </BuiCard>
  ),
  decorators: [
    (Story) => (
      <div className="bg-muted p-6">
        <Story />
      </div>
    ),
  ],
};
