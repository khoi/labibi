import type { Meta, StoryObj } from "@storybook/react-vite";
import { WatchingDood } from "./WatchingDood";

const lookAt = (clientX: number, clientY: number) => {
  window.dispatchEvent(new PointerEvent("pointermove", { clientX, clientY }));
};

const meta = {
  title: "Avatars/Watching dood",
  component: WatchingDood,
  parameters: { layout: "centered" },
  args: { size: 88 },
  argTypes: { size: { control: { type: "range", min: 24, max: 160, step: 2 } } },
} satisfies Meta<typeof WatchingDood>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Small: Story = { args: { size: 32 } };

export const LookingUpLeft: Story = {
  play: () => lookAt(0, 0),
};

export const LookingDownRight: Story = {
  play: () => lookAt(window.innerWidth, window.innerHeight),
};
