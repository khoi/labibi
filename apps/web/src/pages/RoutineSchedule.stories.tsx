import type { CronPreset } from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useArgs } from "storybook/preview-api";
import { fn } from "storybook/test";
import { RoutineSchedule } from "./RoutineSchedule";

const base: CronPreset = { freq: "Every day", n: 3, unit: "minutes", time: "9:00 AM", cron: "" };

const meta = {
  title: "Routines/Schedule",
  component: RoutineSchedule,
  parameters: { layout: "padded" },
  args: { value: base, onChange: fn() },
  decorators: [
    (Story) => (
      <div className="w-[344px]">
        <Story />
      </div>
    ),
  ],
  render: function Render(args) {
    const [, updateArgs] = useArgs<typeof args>();
    return (
      <RoutineSchedule
        {...args}
        onChange={(value) => {
          args.onChange(value);
          updateArgs({ value });
        }}
      />
    );
  },
} satisfies Meta<typeof RoutineSchedule>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EveryDay: Story = {};

export const Weekdays: Story = { args: { value: { ...base, freq: "Weekdays", time: "8:00 AM" } } };

export const Interval: Story = {
  args: { value: { ...base, freq: "Interval", n: 2, unit: "hours" } },
};

export const Advanced: Story = {
  args: { value: { ...base, freq: "Advanced", cron: "*/15 9-17 * * 1-5" } },
};
