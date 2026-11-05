import type { DesktopUpdateState } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useArgs } from "storybook/preview-api";
import { fn } from "storybook/test";
import { SESSION, SPACE_ID } from "../storybook/fixtures";
import { DesktopUpdatesProvider } from "./DesktopUpdates";
import { SidebarFooter } from "./SidebarFooter";

const ORGANIZATIONS = [
  {
    id: "org-1",
    name: "Personal",
    defaultSpaceId: SPACE_ID,
    spaceIds: [SPACE_ID],
    canManage: true,
  },
  {
    id: "org-2",
    name: "Example Studio",
    defaultSpaceId: "space-2",
    spaceIds: ["space-2"],
    canManage: false,
  },
];

const meta = {
  title: "Account/Sidebar footer",
  component: SidebarFooter,
  parameters: { layout: "padded" },
  args: {
    name: SESSION.user.name,
    initials: "AP",
    email: SESSION.user.email,
    logos: [{ name: "Notes" }, { name: "Tasks" }, { name: "Calendar" }],
    open: false,
    onOpenChange: fn(),
    onIntegrations: fn(),
    onSkills: fn(),
    onArtifacts: fn(),
    onSettings: fn(),
    onLogOut: fn(),
    signingOut: false,
    logOutError: null,
  },
  decorators: [
    (Story) => (
      <div className="flex h-[560px] w-64 flex-col justify-end rounded-xl border border-border bg-sidebar">
        <Story />
      </div>
    ),
  ],
  render: function Render(args) {
    const [, updateArgs] = useArgs();
    return (
      <SidebarFooter
        {...args}
        onOpenChange={(open: boolean) => {
          args.onOpenChange(open);
          updateArgs({ open });
        }}
      />
    );
  },
} satisfies Meta<typeof SidebarFooter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const MenuOpen: Story = { args: { open: true } };

export const EverythingInMenu: Story = {
  args: {
    open: true,
    organizations: ORGANIZATIONS,
    activeOrganizationId: "org-1",
    onSwitchOrganization: fn(),
    onBoard: fn(),
    onInvite: fn(),
    links: [{ id: "handbook", label: "Handbook", path: "/handbook", trusted: false }],
    onLink: fn(),
  },
};

export const LogOutFailed: Story = {
  args: { open: true, logOutError: "Could not log out. Try again." },
};

export const Mini: Story = {
  args: { mini: true, open: true },
  decorators: [
    (Story) => (
      <div className="w-12">
        <Story />
      </div>
    ),
  ],
};

export const DesktopUpdateReady: Story = {
  decorators: [
    (Story) => (
      <DesktopUpdatesProvider>
        <Story />
      </DesktopUpdatesProvider>
    ),
  ],
  beforeEach: () => {
    const ready: DesktopUpdateState = {
      phase: "ready",
      currentVersion: "1.4.0",
      availableVersion: "1.5.0",
      percent: null,
      message: null,
      checkedAt: "2026-10-26T08:55:00.000Z",
    };
    const previous = window.rakazoDesktop;
    window.rakazoDesktop = {
      platform: "darwin",
      window: {
        close: async () => undefined,
        minimize: async () => undefined,
        toggleMaximize: async () => undefined,
        state: async () => ({ minimized: false, maximized: false, fullScreen: false }),
      },
      oauth: { onCallback: () => () => undefined },
      update: {
        state: async () => ready,
        check: async () => ready,
        download: async () => ready,
        install: async () => ready,
      },
    };
    return () => {
      window.rakazoDesktop = previous;
    };
  },
};
