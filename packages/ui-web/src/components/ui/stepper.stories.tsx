import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { useState } from "react";
import { Button } from "./button.js";
import type { StepperStep } from "./stepper.js";
import { Stepper } from "./stepper.js";

const setup = [
  { id: "model", title: "Connect a model", description: "Example AI, example-large" },
  { id: "bot", title: "Create your first bot", description: "Give it a name and a job" },
  { id: "team", title: "Invite your team", description: "They join as members" },
] as const;

function at(current: number, busy = false): StepperStep[] {
  return setup.map((step, index) => ({
    ...step,
    status: index < current ? "complete" : index === current ? "current" : "upcoming",
    selectable: index < current,
    busy: busy && index === current,
  }));
}

function Walkthrough(props: ComponentProps<typeof Stepper>) {
  const [current, setCurrent] = useState(1);
  return (
    <div className="flex max-w-sm flex-col gap-2">
      <Stepper
        {...props}
        steps={at(current)}
        onSelect={(id) => setCurrent(setup.findIndex((step) => step.id === id))}
      />
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={current === 0}
          onClick={() => setCurrent((value) => value - 1)}
        >
          Back
        </Button>
        <Button
          disabled={current === setup.length}
          onClick={() => setCurrent((value) => value + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

const meta = {
  title: "Primitives/Stepper",
  component: Stepper,
  parameters: { layout: "padded" },
  args: { steps: at(1), completeLabel: "Done", className: "max-w-sm" },
} satisfies Meta<typeof Stepper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InProgress: Story = {};

export const Busy: Story = {
  args: {
    steps: at(1, true).map((step) =>
      step.id === "bot" ? { ...step, description: "Writing Scout's instructions…" } : step,
    ),
  },
};

export const NotStarted: Story = { args: { steps: at(0) } };

export const AllDone: Story = { args: { steps: at(setup.length) } };

export const Interactive: Story = { render: (args) => <Walkthrough {...args} /> };
