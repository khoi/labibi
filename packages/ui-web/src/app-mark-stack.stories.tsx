import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { AppMarkStack } from "./app-mark-stack.js";

const logo = (shape: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>${shape}</svg>`,
  )}`;

const calendar = logo("<rect x='3' y='5' width='18' height='16' rx='3'/>");
const mail = logo("<path d='M2 6h20v12H2z'/>");
const tasks = logo("<circle cx='12' cy='12' r='10'/>");
const notes = logo("<path d='M12 2 22 21H2z'/>");

const onSidebarAccent: Decorator = (Story) => (
  <div className="rounded-lg bg-sidebar-accent p-3">
    <Story />
  </div>
);

const meta = {
  title: "Avatars/App mark stack",
  component: AppMarkStack,
  parameters: { layout: "centered" },
  args: {
    ringClassName: "ring-sidebar-accent",
    marks: [
      { name: "Calendar", logo: calendar },
      { name: "Mail", logo: mail },
      { name: "Tasks", logo: tasks },
      { name: "Notes", logo: notes },
    ],
  },
  argTypes: {
    size: { control: { type: "range", min: 16, max: 48, step: 2 } },
  },
  decorators: [onSidebarAccent],
} satisfies Meta<typeof AppMarkStack>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Logos: Story = {};

export const Letters: Story = {
  args: { marks: [{ name: "Calendar" }, { name: "Mail" }, { name: "tasks" }, { name: "" }] },
};

export const Fallbacks: Story = {
  args: {
    marks: [
      { name: "Calendar", logo: calendar },
      { name: "Mail", logo: null },
      { name: "Tasks", logo: "data:image/png;base64,broken" },
    ],
  },
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-col items-start gap-3">
      {[24, 30, 36].map((size) => (
        <AppMarkStack key={size} {...args} size={size} />
      ))}
    </div>
  ),
};
