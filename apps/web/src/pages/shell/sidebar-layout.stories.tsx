import { Sidebar } from "@labradoodle/ui-web";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useArgs } from "storybook/preview-api";
import { fn } from "storybook/test";
import { CHIEF, USER_ID } from "../../storybook/fixtures";
import { BotsSidebarLayout, useBotsSidebarWidth } from "./sidebar-layout";

function WidthReadout() {
  const width = useBotsSidebarWidth();
  return <span className="text-sm text-muted-foreground tabular-nums">{width}px</span>;
}

const meta = {
  title: "Shell/Sidebar layout",
  component: BotsSidebarLayout,
  decorators: [
    (Story) => (
      <div style={{ height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    userId: USER_ID,
    collapsed: false,
    onCollapsedChange: fn(),
    onPreviewCollapsedChange: fn(),
    computerOpen: false,
  },
  render: function Render(args) {
    const [, updateArgs] = useArgs<typeof args>();
    return (
      <BotsSidebarLayout
        {...args}
        onCollapsedChange={(collapsed) => {
          args.onCollapsedChange(collapsed);
          updateArgs({ collapsed });
        }}
        className="relative flex h-full min-h-0 min-w-0 overflow-hidden bg-background text-foreground/90"
      >
        <Sidebar collapsible="icon" className="h-full overflow-hidden border-sidebar-border">
          <div className="flex flex-col gap-2 px-[18px] pt-4">
            <span className="truncate text-body2 font-medium text-foreground">{CHIEF.name}</span>
            <WidthReadout />
          </div>
        </Sidebar>
        <main className="isolate flex min-w-0 flex-1 flex-col bg-background" />
      </BotsSidebarLayout>
    );
  },
} satisfies Meta<typeof BotsSidebarLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {};

export const Collapsed: Story = { args: { collapsed: true } };

export const ComputerOpen: Story = { args: { computerOpen: true } };
