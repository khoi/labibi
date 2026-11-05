import type { Meta, StoryObj } from "@storybook/react-vite";
import { SectionHeading } from "./section-heading.js";

const meta = {
  title: "Primitives/Section heading",
  component: SectionHeading,
  parameters: { layout: "centered" },
  args: { children: "Connections" },
  argTypes: {
    variant: { control: "inline-radio", options: ["title", "label"] },
    as: { control: "inline-radio", options: ["h2", "h3", "h4"] },
  },
} satisfies Meta<typeof SectionHeading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Title: Story = {};

export const Label: Story = { args: { variant: "label", children: "Pinned" } };

export const Tiers: Story = {
  render: (args) => (
    <div className="flex w-72 flex-col gap-3">
      <SectionHeading {...args} variant="title">
        Connections
      </SectionHeading>
      <SectionHeading {...args} variant="label">
        Pinned
      </SectionHeading>
      <p className="text-sm text-muted-foreground">Calendar, Mail</p>
    </div>
  ),
};
