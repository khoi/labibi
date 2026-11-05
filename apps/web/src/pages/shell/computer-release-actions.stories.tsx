import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ComputerReleaseActions } from "./computer-release-actions";

const meta = {
  title: "Shell/Computer release actions",
  component: ComputerReleaseActions,
  parameters: { layout: "centered" },
  args: { takeoverRequested: false, onRelease: fn(async () => undefined) },
} satisfies Meta<typeof ComputerReleaseActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Release: Story = {};

export const TakeoverRequested: Story = { args: { takeoverRequested: true } };
