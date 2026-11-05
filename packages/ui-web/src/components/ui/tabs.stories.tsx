import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrainIcon, MessageSquareIcon, SettingsIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs.js";

const panels = (
  <>
    <TabsContent value="chats" className="text-muted-foreground">
      12 chats this week. The latest is about the launch plan.
    </TabsContent>
    <TabsContent value="memory" className="text-muted-foreground">
      Scout remembers 38 facts, like "Ada prefers short answers".
    </TabsContent>
    <TabsContent value="settings" className="text-muted-foreground">
      Model, tools and instructions.
    </TabsContent>
  </>
);

const meta = {
  title: "Primitives/Tabs",
  component: Tabs,
  parameters: { layout: "centered" },
  args: { defaultValue: "chats", className: "w-96" },
  argTypes: { orientation: { control: "inline-radio", options: ["horizontal", "vertical"] } },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Tabs {...args}>
      <TabsList>
        <TabsTrigger value="chats">Chats</TabsTrigger>
        <TabsTrigger value="memory">Memory</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      {panels}
    </Tabs>
  ),
};

export const Line: Story = {
  render: (args) => (
    <Tabs {...args}>
      <TabsList variant="line">
        <TabsTrigger value="chats">Chats</TabsTrigger>
        <TabsTrigger value="memory">Memory</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      {panels}
    </Tabs>
  ),
};

export const WithIcons: Story = {
  render: (args) => (
    <Tabs {...args}>
      <TabsList>
        <TabsTrigger value="chats">
          <MessageSquareIcon />
          Chats
        </TabsTrigger>
        <TabsTrigger value="memory">
          <BrainIcon />
          Memory
        </TabsTrigger>
        <TabsTrigger value="settings" disabled>
          <SettingsIcon />
          Settings
        </TabsTrigger>
      </TabsList>
      {panels}
    </Tabs>
  ),
};

export const Vertical: Story = {
  args: { orientation: "vertical", className: "w-[28rem]" },
  render: Line.render,
};
