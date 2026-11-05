import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { WithPageDocument } from "../../storybook/pages";
import { PageFrame } from "./PageFrame";

const meta = {
  title: "Pages/Page frame",
  component: PageFrame,
  args: { document: "", title: "Q3 launch tracker", onHeight: fn() },
  render: (args) => (
    <WithPageDocument>
      {(document) =>
        document === null ? null : (
          <div className="h-dvh bg-card">
            <PageFrame {...args} document={document} />
          </div>
        )
      }
    </WithPageDocument>
  ),
} satisfies Meta<typeof PageFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Preview: Story = {};

export const Interactive: Story = { args: { interactive: true, onReply: fn() } };
