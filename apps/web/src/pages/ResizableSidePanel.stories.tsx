import type { Meta, StoryObj } from "@storybook/react-vite";
import { ResizableSidePanel } from "./ResizableSidePanel";

const meta = {
  title: "Panels/Resizable side panel",
  component: ResizableSidePanel,
  args: {
    open: true,
    panel: "routines",
    children: (
      <div className="h-full overflow-y-auto px-5 py-4 text-sm">
        <p className="font-medium text-foreground">Routines</p>
        <p className="mt-2 text-muted-foreground">Morning digest runs every weekday at 9:00 AM.</p>
      </div>
    ),
  },
  decorators: [
    (Story) => (
      <div className="relative flex h-screen bg-background">
        <main className="flex-1 p-6 text-sm text-muted-foreground">Chat</main>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ResizableSidePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};

export const Closed: Story = { args: { open: false } };
