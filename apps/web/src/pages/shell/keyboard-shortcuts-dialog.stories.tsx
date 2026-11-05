import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { KeyboardShortcutsDialog } from "./keyboard-shortcuts-dialog";

const meta = {
  title: "Shell/Keyboard shortcuts",
  decorators: [
    (Story) => (
      <main className="min-h-screen bg-background">
        <Story />
      </main>
    ),
  ],
  component: KeyboardShortcutsDialog,
  args: {
    open: true,
    onOpenChange: fn(),
    host: { desktop: false, apple: true },
    dictation: false,
  },
} satisfies Meta<typeof KeyboardShortcutsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Browser: Story = {};

export const DesktopMac: Story = { args: { host: { desktop: true, apple: true } } };

export const DesktopWindowsWithDictation: Story = {
  args: { host: { desktop: true, apple: false }, dictation: true },
};
