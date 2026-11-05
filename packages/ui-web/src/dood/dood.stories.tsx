import type { DoodColor, DoodEyes, DoodShape, LogoAvatarActivity } from "@labradoodle/core";
import { DOOD_COLORS, DOOD_RESTING_EYES, DOOD_SHAPES, doodPose } from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Dood } from "./dood.js";

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
const eyes = [...DOOD_RESTING_EYES, "cross"] as const satisfies readonly DoodEyes[];
const sizes = [12, 16, 18, 20, 28, 36, 52, 96, 120];

type Args = {
  shape: DoodShape;
  color: DoodColor;
  eyes: DoodEyes;
  activity: LogoAvatarActivity;
  size: number;
  motion: boolean;
};

function Look({ shape, color, eyes, activity, size, motion }: Args) {
  return (
    <Dood dood={{ shape, color, eyes }} pose={doodPose(activity)} size={size} motion={motion} />
  );
}

function Labeled({ label, ...args }: Args & { label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <Look {...args} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

const meta = {
  title: "Avatars/Dood",
  parameters: { layout: "centered" },
  args: {
    shape: "circle",
    color: "yellow",
    eyes: "round",
    activity: "idle",
    size: 96,
    motion: true,
  },
  argTypes: {
    shape: { control: "select", options: DOOD_SHAPES },
    color: { control: "select", options: DOOD_COLORS },
    eyes: { control: "select", options: eyes },
    activity: { control: "select", options: activities },
    size: { control: { type: "range", min: 12, max: 160, step: 2 } },
  },
  render: (args) => <Look {...args} />,
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Activities: Story = {
  args: { size: 64 },
  render: (args) => (
    <div className="grid grid-cols-4 gap-8">
      {activities.map((activity) => (
        <Labeled key={activity} {...args} activity={activity} label={activity} />
      ))}
    </div>
  ),
};

export const Colors: Story = {
  args: { size: 64 },
  render: (args) => (
    <div className="flex flex-wrap gap-8">
      {DOOD_COLORS.map((color) => (
        <Labeled key={color} {...args} color={color} label={color} />
      ))}
    </div>
  ),
};

export const Shapes: Story = {
  args: { size: 64 },
  render: (args) => (
    <div className="grid grid-cols-4 gap-8">
      {DOOD_SHAPES.map((shape) => (
        <Labeled key={shape} {...args} shape={shape} label={shape} />
      ))}
    </div>
  ),
};

export const Eyes: Story = {
  args: { size: 64 },
  render: (args) => (
    <div className="flex gap-8">
      {eyes.map((eye) => (
        <Labeled key={eye} {...args} eyes={eye} label={eye} />
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-end gap-4">
      {sizes.map((size) => (
        <Labeled key={size} {...args} size={size} label={String(size)} />
      ))}
    </div>
  ),
};
