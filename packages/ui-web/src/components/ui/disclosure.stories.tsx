import type { Meta, StoryObj } from "@storybook/react-vite";
import { Disclosure } from "./disclosure.js";
import { Field, FieldDescription, FieldLabel } from "./field.js";
import { Input } from "./input.js";

const meta = {
  title: "Primitives/Disclosure",
  component: Disclosure,
  parameters: { layout: "padded" },
  args: {
    summary: "Advanced",
    summaryClassName: "text-sm font-medium",
    contentClassName: "pt-3",
    className: "w-96",
    children: (
      <Field>
        <FieldLabel htmlFor="disclosure-max-tokens">Max output tokens</FieldLabel>
        <Input id="disclosure-max-tokens" inputMode="numeric" defaultValue="4096" />
        <FieldDescription>Longer replies cost more and take longer.</FieldDescription>
      </Field>
    ),
  },
} satisfies Meta<typeof Disclosure>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Open: Story = { args: { defaultOpen: true } };

export const Details: Story = {
  args: {
    defaultOpen: true,
    summary: "Last check failed 2 minutes ago",
    summaryClassName: "text-sm text-muted-foreground",
    children: (
      <pre className="rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap text-muted-foreground">
        GET https://tools.example.test/mcp returned 503 Service Unavailable after 3 attempts.
      </pre>
    ),
  },
};
