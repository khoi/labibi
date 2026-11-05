import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageLoading } from "./PageLoading";

const meta = {
  title: "Primitives/Page loading",
  component: PageLoading,
  decorators: [
    (Story) => (
      <div className="h-screen">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PageLoading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
