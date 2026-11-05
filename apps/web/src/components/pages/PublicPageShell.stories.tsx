import type { Meta, StoryObj } from "@storybook/react-vite";
import { WithPageDocument } from "../../storybook/pages";
import { PublicPageShell } from "./PublicPageShell";

const meta = {
  title: "Pages/Public page shell",
  component: PublicPageShell,
  args: { title: "Q3 launch tracker", document: null },
  render: (args) => (
    <WithPageDocument>
      {(document) => <PublicPageShell {...args} document={document} />}
    </WithPageDocument>
  ),
} satisfies Meta<typeof PublicPageShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SharedPage: Story = {};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
