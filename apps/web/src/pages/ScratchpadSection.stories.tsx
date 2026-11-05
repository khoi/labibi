import type { ScratchpadItem } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../storybook/api";
import { CHIEF, NOW } from "../storybook/fixtures";
import { ScratchpadSection } from "./ScratchpadSection";

function item(id: string, title: string, extra: Partial<ScratchpadItem> = {}): ScratchpadItem {
  return {
    id,
    botId: CHIEF.id,
    title,
    status: "open",
    notes: "",
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

const ITEMS = [
  item("work-1", "Draft the Q3 summary", { notes: "One paragraph, due Monday" }),
  item("work-2", "Confirm the venue for the offsite", { status: "parked" }),
  item("work-3", "Send October invoices to finance"),
];

const MANY = [
  ...ITEMS,
  item("work-4", "Review the onboarding checklist"),
  item("work-5", "Collect feedback on the launch post"),
  item("work-6", "Archive last quarter's planning notes"),
  item("work-7", "Book travel for the design review"),
];

const meta = {
  title: "Settings/Scratchpad",
  component: ScratchpadSection,
  parameters: { layout: "padded", api: api({ scratchpad: { list: ITEMS } }) },
  args: { botId: CHIEF.id },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ScratchpadSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OpenWork: Story = {};

export const LongList: Story = {
  parameters: { api: api({ scratchpad: { list: MANY } }) },
};

export const LongTitle: Story = {
  parameters: {
    api: api({
      scratchpad: {
        list: [
          item(
            "work-long",
            "Review the proposed settings and document the remaining decisions before the next design review",
            { notes: "Compare both themes and note which screens still need a dark variant" },
          ),
        ],
      },
    }),
  },
};

export const Adding: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Add open work" }));
  },
};

export const RemoveFailed: Story = {
  parameters: {
    api: api({
      scratchpad: {
        list: ITEMS,
        remove: () => {
          throw new ORPCError("FORBIDDEN", { message: "Not allowed" });
        },
      },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    const [first] = await canvas.findAllByRole("button", { name: "Remove" });
    if (first) await userEvent.click(first);
  },
};
