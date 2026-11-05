import type { Meta, StoryObj } from "@storybook/react-vite";
import { DownloadPdfButton } from "./DownloadPdfButton";

const meta = {
  title: "Pages/Download PDF button",
  component: DownloadPdfButton,
  parameters: { layout: "centered" },
  args: {
    className:
      "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-foreground ring-[0.5px] ring-border",
  },
} satisfies Meta<typeof DownloadPdfButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithLabel: Story = {};

export const IconOnly: Story = {
  args: {
    className:
      "grid size-[35px] place-items-center rounded-full border border-foreground/[0.06] p-0 text-foreground",
    iconClassName: "size-[18px]",
    labelClassName: "sr-only",
  },
};
