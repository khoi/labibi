import type { ComputerStatus } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CHIEF } from "../../storybook/fixtures";
import { computerLabel, computerPlaceholder, DesktopKindEmptyState } from "./computer-view";

const STATES: ComputerStatus["state"][] = ["booting", "running", "suspended", "stopped", "error"];

const meta = {
  title: "Shell/Computer view",
  component: DesktopKindEmptyState,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    className:
      "grid place-items-center rounded-[14px] bg-muted/50 px-6 py-7 text-center text-sm text-muted-foreground/80",
  },
} satisfies Meta<typeof DesktopKindEmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DesktopKind: Story = {};

export const Placeholders: Story = {
  render: () => (
    <dl className="divide-y divide-border">
      {STATES.map((state) => (
        <div key={state} className="flex items-center justify-between gap-4 py-2 text-sm">
          <dt className="text-foreground">{state}</dt>
          <dd className="text-muted-foreground">
            {computerPlaceholder(state, false, computerLabel("team", CHIEF.name))}
          </dd>
        </div>
      ))}
      <div className="flex items-center justify-between gap-4 py-2 text-sm">
        <dt className="text-foreground">dedicated</dt>
        <dd className="text-muted-foreground">{computerLabel("dedicated", CHIEF.name)}</dd>
      </div>
    </dl>
  ),
};
