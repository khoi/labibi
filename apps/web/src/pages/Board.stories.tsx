import type { Ticket, TicketComment } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { api } from "../storybook/api";
import { BOTS, CHIEF, LEDGER, NOW, SCOUT, SPACE_ID, USER_ID } from "../storybook/fixtures";
import { BoardPage } from "./Board";

let number = 0;
function ticket(overrides: Partial<Ticket> & Pick<Ticket, "title" | "status">): Ticket {
  number += 1;
  return {
    id: `ticket-${number}`,
    boardId: "board-1",
    spaceId: SPACE_ID,
    number,
    ref: `OPS-${number}`,
    description: null,
    priority: "normal",
    assigneeBotId: CHIEF.id,
    createdByBotId: null,
    createdByUserId: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
    ...overrides,
  };
}

const TICKETS: Ticket[] = [
  ticket({ title: "Draft the Q3 report summary", status: "todo" }),
  ticket({
    title: "Collect churn numbers from the finance sheet",
    status: "todo",
    assigneeBotId: LEDGER.id,
    priority: "high",
  }),
  ticket({
    title: "Research three onboarding examples",
    status: "doing",
    assigneeBotId: SCOUT.id,
    description: "Look for short, friendly first-run flows and note what they skip.",
  }),
  ticket({ title: "Review the launch post", status: "review" }),
  ticket({
    title: "Reconcile October invoices",
    status: "blocked",
    assigneeBotId: LEDGER.id,
    priority: "urgent",
  }),
  ticket({ title: "Schedule the team retro", status: "done", completedAt: NOW }),
  ticket({ title: "Archive last quarter's notes", status: "closed", completedAt: NOW }),
];

const COMMENTS: TicketComment[] = [
  {
    id: "comment-1",
    ticketId: TICKETS[2]!.id,
    body: "Found two good examples so far. Writing up the **third** now.",
    authorBotId: SCOUT.id,
    authorUserId: null,
    authorName: SCOUT.name,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: "comment-2",
    ticketId: TICKETS[2]!.id,
    body: "Keep it to one page, please.",
    authorBotId: null,
    authorUserId: USER_ID,
    authorName: "Ada Park",
    createdAt: NOW,
    updatedAt: NOW,
  },
];

async function* quiet() {
  await new Promise(() => {});
  yield* [];
}

const meta = {
  title: "Views/Board",
  component: BoardPage,
  parameters: {
    route: "/app/board",
    api: api({
      boards: { subscribe: quiet },
      bots: { list: BOTS },
      tickets: { list: { tickets: TICKETS }, comments: COMMENTS },
    }),
  },
} satisfies Meta<typeof BoardPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Columns: Story = {};

export const Empty: Story = {
  parameters: { api: api({ tickets: { list: { tickets: [] } } }) },
};

export const TicketOpen: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByText("Research three onboarding examples"));
  },
};

export const NewTicket: Story = {
  play: async ({ canvas, userEvent }) => {
    const button = await canvas.findByRole("button", { name: "New ticket" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
  },
};

export const LoadError: Story = {
  parameters: {
    api: api({
      tickets: {
        list: () => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Could not load the board." });
        },
      },
    }),
  },
};
