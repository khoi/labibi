import type { Meta, StoryObj } from "@storybook/react-vite";
import { App } from "./App";
import { CHIEF, GROUP } from "./storybook/fixtures";

const meta = {
  title: "Views/App",
  component: App,
} satisfies Meta<typeof App>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Chat: Story = { parameters: { route: `/app/${CHIEF.id}` } };

export const GroupChat: Story = { parameters: { route: `/app/g/${GROUP.id}` } };

export const SignIn: Story = {
  parameters: { route: "/sign-in", http: { "/api/auth/get-session": null } },
};

export const NotFound: Story = { parameters: { route: "/nowhere" } };
