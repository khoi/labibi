import type { PageSummary } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Moon, Plug, Settings, Users } from "lucide-react";
import { fn, screen, userEvent } from "storybook/test";
import { BOTS, CHIEF, GROUP, NOW, SCOUT } from "../../storybook/fixtures";
import type { CommandPaletteAction } from "./command-palette";
import { CommandPalette } from "./command-palette";

const ACTIONS: CommandPaletteAction[] = [
  { id: "new-group", label: "New group chat", icon: Users, onSelect: fn() },
  { id: "connect-apps", label: "Connect apps", icon: Plug, onSelect: fn() },
  { id: "dark-mode", label: "Dark mode", icon: Moon, checked: true, onSelect: fn() },
  { id: "settings", label: "Settings", icon: Settings, onSelect: fn() },
];

function page(overrides: Partial<PageSummary> & Pick<PageSummary, "id" | "title">): PageSummary {
  return {
    botId: CHIEF.id,
    groupId: null,
    visibility: "private",
    currentVersion: 1,
    pinned: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const PAGES: PageSummary[] = [
  page({ id: "page-1", title: "Q3 report", pinned: true }),
  page({ id: "page-2", title: "Churn sources", botId: SCOUT.id }),
  page({ id: "page-3", title: "Launch checklist", botId: null, groupId: GROUP.id }),
];

const meta = {
  title: "Shell/Command palette",
  decorators: [
    (Story) => (
      <main className="min-h-screen bg-background">
        <Story />
      </main>
    ),
  ],
  component: CommandPalette,
  args: {
    open: true,
    onOpenChange: fn(),
    bots: BOTS,
    onSelectBot: fn(),
    actions: ACTIONS,
    pages: PAGES,
    onSelectPage: fn(),
    onSearchChange: fn(),
  },
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};

export const WithoutPages: Story = { args: { pages: [] } };

export const SearchMatchesPage: Story = {
  play: async () => {
    await userEvent.type(await screen.findByPlaceholderText("Search"), "launch");
  },
};

export const NoResults: Story = {
  play: async () => {
    await userEvent.type(await screen.findByPlaceholderText("Search"), "zzz");
    await screen.findByText("No results");
  },
};
