import { ChatMarkdown } from "@labradoodle/chat-ui/web";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MarkdownChrome } from "./markdown-copy";

const table = `| Month | Invoices | Paid |
| --- | ---: | ---: |
| July | 42 | 40 |
| August | 38 | 38 |
| September | 45 | 41 |`;

const code =
  "```ts\nexport function total(invoices: number[]) {\n  return invoices.reduce((sum, value) => sum + value, 0);\n}\n```";

const meta = {
  title: "Primitives/Markdown chrome",
  parameters: { layout: "padded" },
  args: { markdown: table },
  argTypes: { markdown: { control: "text" } },
  render: ({ markdown }) => (
    <MarkdownChrome>
      <div className="max-w-2xl">
        <ChatMarkdown>{markdown}</ChatMarkdown>
      </div>
    </MarkdownChrome>
  ),
} satisfies Meta<{ markdown: string }>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Table: Story = {};

export const Code: Story = { args: { markdown: code } };
