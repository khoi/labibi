import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, screen } from "storybook/test";
import { api } from "../storybook/api";
import { CreateOrganizationDialog } from "./CreateOrganizationDialog";

const meta = {
  title: "Account/Create organization",
  component: CreateOrganizationDialog,
  args: { open: true, onOpenChange: fn(), openSpaceChat: fn() },
  decorators: [
    (Story) => (
      <div className="min-h-screen">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CreateOrganizationDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Named: Story = {
  play: async ({ userEvent }) => {
    await userEvent.type(await screen.findByRole("textbox", { name: "Name" }), "Example Studio");
  },
};

export const CreateFailed: Story = {
  parameters: {
    api: api({
      organizations: {
        create: () => {
          throw new ORPCError("CONFLICT", { message: "An organization with this name exists" });
        },
      },
    }),
  },
  play: async ({ userEvent }) => {
    await userEvent.type(await screen.findByRole("textbox", { name: "Name" }), "Personal{Enter}");
  },
};
