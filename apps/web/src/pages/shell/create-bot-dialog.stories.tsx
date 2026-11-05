import { BOT_COLOR_LIST } from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, screen, userEvent } from "storybook/test";
import { CreateBotDialog } from "./create-bot-dialog";

async function fillLook() {
  await userEvent.type(await screen.findByPlaceholderText("Name your Bot"), "Inbox");
  await userEvent.click(screen.getByRole("button", { name: "Shape 1" }));
  await userEvent.click(screen.getByRole("button", { name: `Color ${BOT_COLOR_LIST[4]!.hex}` }));
}

const meta = {
  title: "Shell/Create bot dialog",
  decorators: [
    (Story) => (
      <main className="min-h-screen bg-background">
        <Story />
      </main>
    ),
  ],
  component: CreateBotDialog,
  args: { onCancel: fn(), onCreate: fn(async () => undefined) },
} satisfies Meta<typeof CreateBotDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Filled: Story = { play: fillLook };

export const CreateError: Story = {
  args: {
    onCreate: fn(async () => {
      throw new Error("You have reached the bot limit for this space.");
    }),
  },
  play: async () => {
    await fillLook();
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("You have reached the bot limit for this space.");
  },
};
