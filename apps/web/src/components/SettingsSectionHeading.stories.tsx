import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsSectionHeading } from "./SettingsSectionHeading";

const meta = {
  title: "Primitives/Settings section heading",
  component: SettingsSectionHeading,
  parameters: { layout: "padded" },
  args: { children: "Appearance" },
} satisfies Meta<typeof SettingsSectionHeading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AboveContent: Story = {
  render: (args) => (
    <section className="max-w-2xl">
      <SettingsSectionHeading {...args} />
      <div className="rounded-xl border border-border px-4 py-3 text-[14px] text-foreground">
        Theme
      </div>
    </section>
  ),
};
