import type { Meta, StoryObj } from "@storybook/react-vite";
import { NotFoundPage } from "./NotFound";

const meta = {
  title: "Views/Not found",
  component: NotFoundPage,
  parameters: { route: "/nowhere" },
} satisfies Meta<typeof NotFoundPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
