import type { Meta, StoryObj } from "@storybook/react-vite";
import { CheckIcon, CircleAlertIcon } from "lucide-react";
import { Badge } from "./badge.js";

const variants = ["default", "secondary", "destructive", "outline", "ghost", "link"] as const;

const meta = {
  title: "Primitives/Badge",
  component: Badge,
  parameters: { layout: "centered" },
  args: { children: "Owner" },
  argTypes: { variant: { control: "select", options: variants } },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {variants.map((variant) => (
        <Badge key={variant} {...args} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  ),
};

export const WithIcon: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Badge {...args} variant="secondary">
        <CheckIcon data-icon="inline-start" />
        Connected
      </Badge>
      <Badge {...args} variant="destructive">
        <CircleAlertIcon data-icon="inline-start" />
        Sign-in expired
      </Badge>
    </div>
  ),
};

export const AsLink: Story = {
  args: {
    variant: "link",
    children: "3 new replies",
    render: (props) => <a {...props} href="#replies" />,
  },
};
