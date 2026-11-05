import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  StandaloneToolActivity,
  ToolActivityDisclosure,
  ToolOnlyNarration,
  ToolSteps,
} from "./ToolActivityDisclosure";

const STEPS = [
  "Open calendar",
  "Read events",
  "Search inbox",
  "Read message",
  "Check time zones",
  "Compare calendars",
  "Draft invite",
  "Check conflicts",
].map((label) => ({ label, count: 1 }));

const FINISHED_STEPS = STEPS.map((step) =>
  step.label === "Check conflicts"
    ? { ...step, note: "Anna is free all Tuesday afternoon." }
    : step,
);

const meta = {
  title: "Chat/Tool activity",
  component: ToolActivityDisclosure,
  parameters: { layout: "padded" },
  args: {
    live: false,
    stepCount: FINISHED_STEPS.length,
    durationMs: 12_400,
    children: <ToolSteps steps={FINISHED_STEPS} />,
  },
} satisfies Meta<typeof ToolActivityDisclosure>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Done: Story = {};

export const DoneExpanded: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Done/ }));
  },
};

export const Working: Story = {
  render: () => <StandaloneToolActivity live steps={STEPS} stepCount={STEPS.length} />,
};

export const RepeatedSteps: Story = {
  render: () => (
    <ToolOnlyNarration
      live={false}
      blocks={[
        {
          kind: "steps",
          steps: [
            { label: "Open calendar", count: 1 },
            { label: "Read events", count: 3 },
            { label: "Search inbox", count: 2 },
          ],
          durationMs: 8_200,
        },
      ]}
    />
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /Done/ }));
  },
};
