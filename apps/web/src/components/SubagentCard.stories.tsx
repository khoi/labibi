import type { Meta, StoryObj } from "@storybook/react-vite";
import { SubagentCard } from "./SubagentCard";

const meta = {
  title: "Chat/Subagent card",
  component: SubagentCard,
  parameters: { layout: "padded" },
  args: {
    block: {
      kind: "subagent",
      agentId: "story-running",
      name: "Writer",
      task: "Draft the offsite invite for the whole team, with the venue, the date and a short agenda",
      status: "running",
      progress: "Writing the second paragraph",
    },
  },
} satisfies Meta<typeof SubagentCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};

export const Completed: Story = {
  args: {
    block: {
      kind: "subagent",
      agentId: "story-completed",
      name: "Researcher",
      task: "Compare three venues",
      status: "completed",
      result: "The Loft is cheapest and free on Tuesday.",
    },
  },
};

export const Failed: Story = {
  args: {
    block: {
      kind: "subagent",
      agentId: "story-failed",
      name: "Booker",
      task: "Reserve the room",
      status: "failed",
      result: "The booking site timed out.",
    },
  },
};

export const Expanded: Story = {
  args: {
    block: {
      kind: "subagent",
      agentId: "story-expanded",
      name: "Researcher",
      task: "Compare The Loft, Harbor Hall and Pine Room on price, capacity and Tuesday availability",
      status: "completed",
      result:
        "**The Loft** is cheapest and free on Tuesday.\n\n- Harbor Hall is booked until Thursday\n- Pine Room fits 20 people, too small for the team",
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button"));
  },
};
