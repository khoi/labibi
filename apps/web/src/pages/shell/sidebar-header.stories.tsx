import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { BOTS } from "../../storybook/fixtures";
import { SidebarHeader } from "./sidebar-header";

const meta = {
  title: "Shell/Sidebar header",
  component: SidebarHeader,
  parameters: { layout: "padded" },
  decorators: [
    (Story, { args }) => (
      <div className="rounded-xl bg-sidebar" style={{ width: args.mini ? 72 : 300 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    createMenuOpen: false,
    setCreateMenuOpen: fn(),
    activityMode: false,
    toggleActivityMode: fn(),
    onSearch: fn(),
    setBotsSidebarCollapsedPref: fn(),
    bots: BOTS,
    setMobileSidebarOpen: fn(),
    setPanel: fn(),
    navigate: fn(),
    setNewSpaceOpen: fn(),
    setCreateBotOpen: fn(),
  },
} satisfies Meta<typeof SidebarHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SearchOpen: Story = { args: { searchOpen: true } };

export const ActivityOn: Story = { args: { activityMode: true } };

export const CreateMenuOpen: Story = {
  args: { createMenuOpen: true },
  decorators: [
    (Story) => (
      <div style={{ height: 420 }}>
        <Story />
      </div>
    ),
  ],
};

export const Mini: Story = { args: { mini: true } };
