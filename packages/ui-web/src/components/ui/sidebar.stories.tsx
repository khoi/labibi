import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  BotIcon,
  CalendarClockIcon,
  ChevronsUpDownIcon,
  PlusIcon,
  SettingsIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import type { ComponentProps } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "./sidebar.js";

const bots = [
  { id: "chief", name: "Chief", unread: 0 },
  { id: "scout", name: "Scout", unread: 3 },
  { id: "ledger", name: "Ledger", unread: 0 },
];

function Shell({
  loading = false,
  defaultOpen = true,
  ...props
}: ComponentProps<typeof Sidebar> & { loading?: boolean; defaultOpen?: boolean }) {
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <Sidebar {...props}>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Research team">
                <UsersIcon />
                <span>Research team</span>
                <ChevronsUpDownIcon className="ml-auto" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarInput
            aria-label="Search"
            placeholder="Search"
            className="group-data-[collapsible=icon]:hidden"
          />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Bots</SidebarGroupLabel>
            <SidebarGroupAction title="New bot">
              <PlusIcon />
              <span className="sr-only">New bot</span>
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                {loading
                  ? [0, 1, 2].map((index) => (
                      <SidebarMenuItem key={index}>
                        <SidebarMenuSkeleton showIcon />
                      </SidebarMenuItem>
                    ))
                  : bots.map((bot) => (
                      <SidebarMenuItem key={bot.id}>
                        <SidebarMenuButton isActive={bot.id === "chief"} tooltip={bot.name}>
                          <BotIcon />
                          <span>{bot.name}</span>
                        </SidebarMenuButton>
                        {bot.unread ? <SidebarMenuBadge>{bot.unread}</SidebarMenuBadge> : null}
                      </SidebarMenuItem>
                    ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />
          <SidebarGroup>
            <SidebarGroupLabel>Routines</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Routines">
                    <CalendarClockIcon />
                    <span>Routines</span>
                  </SidebarMenuButton>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton href="#digest" isActive>
                        <span>Morning digest</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton href="#invoices">
                        <span>Invoice check</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Settings">
                <SettingsIcon />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Ada Park">
                <UserIcon />
                <span>Ada Park</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <span className="text-sm font-medium">Chief</span>
        </header>
        <div className="p-4 text-sm text-muted-foreground">Ask Chief anything about the team.</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

const meta = {
  title: "Primitives/Sidebar",
  component: Sidebar,
  args: { side: "left", variant: "sidebar", collapsible: "icon" },
  argTypes: {
    side: { control: "inline-radio", options: ["left", "right"] },
    variant: { control: "inline-radio", options: ["sidebar", "floating", "inset"] },
    collapsible: { control: "inline-radio", options: ["offcanvas", "icon", "none"] },
  },
  render: (args) => <Shell {...args} />,
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {};

export const CollapsedToIcons: Story = {
  render: (args) => <Shell {...args} defaultOpen={false} />,
};

export const Floating: Story = { args: { variant: "floating" } };

export const Inset: Story = { args: { variant: "inset" } };

export const Right: Story = { args: { side: "right" } };

export const Loading: Story = { render: (args) => <Shell {...args} loading /> };
