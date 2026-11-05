import { Button } from "@labradoodle/ui-web";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Settings } from "lucide-react";
import { userEvent, within } from "storybook/test";
import { IconTooltip } from "./IconTooltip";

const meta = {
  title: "Primitives/Icon tooltip",
  component: IconTooltip,
  parameters: { layout: "centered" },
  args: {
    label: "Settings",
    children: (
      <Button variant="ghost" size="icon" aria-label="Settings">
        <Settings />
      </Button>
    ),
  },
  argTypes: {
    side: { control: "inline-radio", options: ["top", "right", "bottom", "left"] },
  },
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByRole("button"));
  },
} satisfies Meta<typeof IconTooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Hovered: Story = {};

export const Bottom: Story = { args: { side: "bottom" } };

export const Resting: Story = { play: () => {} };
