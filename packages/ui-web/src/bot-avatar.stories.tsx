import type { LogoAvatarActivity } from "@labradoodle/core";
import { BOT_COLOR_LIST, DOOD_SHAPES } from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { BotAvatar, BotShapePreview } from "./bot-avatar.js";

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
const statuses = ["idle", "queued", "running", "waiting_input", "completed", "failed"];
const sizes = [12, 14, 16, 18, 20, 22, 26, 28, 32, 36, 38, 40, 44, 48, 52, 64, 78, 96, 120];
const photo = `data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><rect width='40' height='40' fill='silver'/><circle cx='20' cy='16' r='7' fill='gray'/><rect x='8' y='26' width='24' height='20' rx='12' fill='gray'/></svg>",
)}`;

const meta = {
  title: "Avatars/Bot avatar",
  component: BotAvatar,
  parameters: { layout: "centered" },
  args: { color: BOT_COLOR_LIST[0]!.hex, identity: "bot-1", size: 52 },
  argTypes: {
    color: {
      control: {
        type: "select",
        labels: Object.fromEntries(BOT_COLOR_LIST.map((color) => [color.hex, color.name])),
      },
      options: BOT_COLOR_LIST.map((color) => color.hex),
    },
    activity: { control: "select", options: activities },
    status: { control: "select", options: statuses },
    size: { control: { type: "range", min: 12, max: 120, step: 2 } },
  },
} satisfies Meta<typeof BotAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Colors: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-end gap-6">
      {BOT_COLOR_LIST.map((color) => (
        <div key={color.id} className="flex flex-col items-center gap-2">
          <BotAvatar {...args} color={color.hex} identity={color.id} />
          <span className="text-xs text-muted-foreground">{color.name}</span>
        </div>
      ))}
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex max-w-5xl flex-wrap items-end gap-4">
      {sizes.map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <BotAvatar {...args} size={size} />
          <span className="text-xs text-muted-foreground tabular-nums">{size}</span>
        </div>
      ))}
    </div>
  ),
};

export const Activities: Story = {
  render: (args) => (
    <div className="grid grid-cols-4 gap-8">
      {activities.map((activity) => (
        <div key={activity} className="flex flex-col items-center gap-2">
          <BotAvatar {...args} activity={activity} />
          <span className="text-xs text-muted-foreground">{activity}</span>
        </div>
      ))}
    </div>
  ),
};

export const Shapes: Story = {
  render: (args) => (
    <div className="grid grid-cols-4 gap-6">
      {DOOD_SHAPES.map((shape, index) => (
        <div key={shape} className="flex flex-col items-center gap-2">
          <BotAvatar {...args} color={`${args.color}::shape_${index}`} />
          <span className="text-xs text-muted-foreground">{shape}</span>
        </div>
      ))}
    </div>
  ),
};

export const Photo: Story = {
  args: { color: photo },
  render: (args) => (
    <div className="flex items-center gap-8">
      <BotAvatar {...args} />
      <BotAvatar {...args} status="running" />
    </div>
  ),
};

function ShapePicker({ color }: { color: string }) {
  const [selected, setSelected] = useState<number | undefined>(2);
  return (
    <div className="grid grid-cols-4 place-items-center gap-2 rounded-xl bg-popover p-3">
      {DOOD_SHAPES.map((shape, index) => (
        <BotShapePreview
          key={shape}
          shapeIndex={index}
          identity="bot-1"
          label={`Shape ${index + 1}`}
          color={color}
          selected={selected === index}
          onClick={() => setSelected(index)}
        />
      ))}
    </div>
  );
}

export const ShapePreview: Story = {
  render: (args) => <ShapePicker color={args.color} />,
};
