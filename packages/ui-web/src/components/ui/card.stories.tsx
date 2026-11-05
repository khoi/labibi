import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button.js";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card.js";

const meta = {
  title: "Primitives/Card",
  component: Card,
  parameters: { layout: "padded" },
  argTypes: { size: { control: "inline-radio", options: ["default", "sm"] } },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Card {...args} className="max-w-md">
      <CardHeader>
        <CardTitle>Morning digest</CardTitle>
        <CardDescription>Every weekday at 8:00</CardDescription>
      </CardHeader>
      <CardContent>
        Chief reads overnight messages in #research and posts a short summary with open questions.
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline">Pause</Button>
        <Button>Run now</Button>
      </CardFooter>
    </Card>
  ),
};

export const WithAction: Story = {
  render: (args) => (
    <Card {...args} className="max-w-md">
      <CardHeader>
        <CardTitle>Example AI</CardTitle>
        <CardDescription>example-large, example-small</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm">
            Edit
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="text-muted-foreground">Used by Chief, Scout and Ledger.</CardContent>
    </Card>
  ),
};

export const Small: Story = { ...Default, args: { size: "sm" } };

export const ContentOnly: Story = {
  render: (args) => (
    <Card {...args} className="max-w-md">
      <CardContent>
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground">Messages this month</span>
          <span className="text-base font-medium tabular-nums">1,284</span>
        </div>
      </CardContent>
    </Card>
  ),
};
