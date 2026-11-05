import type { DoodColor, DoodEyes, DoodShape, LogoAvatarActivity } from "@labradoodle/core";
import { DOOD_COLORS, DOOD_RESTING_EYES, DOOD_SHAPES, doodPose } from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import RiveDood from "./rive-dood.js";
import "./dood.css";

const activities = [
  "idle",
  "thinking",
  "reading",
  "writing",
  "computer",
  "working",
  "waiting",
  "error",
] as const satisfies readonly LogoAvatarActivity[];

type Args = {
  shape: DoodShape;
  color: DoodColor;
  eyes: DoodEyes;
  activity: LogoAvatarActivity;
  size: number;
};

type Theme = "light" | "dark";

const themeOf = (globals: Record<string, unknown>): Theme =>
  globals.theme === "dark" ? "dark" : "light";

function Look({ shape, color, eyes, activity, size, theme }: Args & { theme: Theme }) {
  const pose = doodPose(activity);
  return (
    <span className="labradoodle-dood" style={{ "--dood-size": `${size}px` } as CSSProperties}>
      <RiveDood
        dood={{ shape, color, eyes: pose.eyes ?? eyes }}
        form={pose.form}
        state={pose.state}
        theme={theme}
        onShown={() => {}}
      />
    </span>
  );
}

function Labeled({ label, ...args }: Args & { theme: Theme; label: string }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <Look {...args} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function themed(args: Args, { globals }: { globals: Record<string, unknown> }) {
  return <Look {...args} theme={themeOf(globals)} />;
}

const meta = {
  title: "Avatars/Rive dood",
  parameters: { layout: "centered" },
  args: {
    shape: "circle",
    color: "yellow",
    eyes: "round",
    activity: "idle",
    size: 120,
  },
  argTypes: {
    shape: { control: "select", options: DOOD_SHAPES },
    color: { control: "select", options: DOOD_COLORS },
    eyes: { control: "select", options: DOOD_RESTING_EYES },
    activity: { control: "select", options: activities },
    size: { control: { type: "range", min: 20, max: 200, step: 4 } },
  },
  render: themed,
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Activities: Story = {
  args: { size: 64 },
  render: (args, { globals }) => (
    <div className="grid grid-cols-4 gap-10">
      {activities.map((activity) => (
        <Labeled
          key={activity}
          {...args}
          theme={themeOf(globals)}
          activity={activity}
          label={activity}
        />
      ))}
    </div>
  ),
};

export const Colors: Story = {
  args: { size: 64 },
  render: (args, { globals }) => (
    <div className="flex flex-wrap gap-10">
      {DOOD_COLORS.map((color) => (
        <Labeled key={color} {...args} theme={themeOf(globals)} color={color} label={color} />
      ))}
    </div>
  ),
};

export const Shapes: Story = {
  args: { size: 64 },
  render: (args, { globals }) => (
    <div className="grid grid-cols-4 gap-10">
      {DOOD_SHAPES.map((shape) => (
        <Labeled key={shape} {...args} theme={themeOf(globals)} shape={shape} label={shape} />
      ))}
    </div>
  ),
};
