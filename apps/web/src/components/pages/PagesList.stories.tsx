import type { PageSummary } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../../storybook/api";
import { CHIEF } from "../../storybook/fixtures";
import { PagesList } from "./PagesList";

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60_000).toISOString();

const page = (
  id: string,
  title: string,
  hours: number,
  extra: Partial<PageSummary> = {},
): PageSummary => ({
  id,
  title,
  botId: CHIEF.id,
  groupId: null,
  visibility: "private",
  currentVersion: 1,
  pinned: false,
  createdAt: hoursAgo(hours),
  updatedAt: hoursAgo(hours),
  ...extra,
});

const PAGES = [
  page("page-1", "Q3 launch tracker", 2, { pinned: true, visibility: "link" }),
  page("page-2", "Offsite plan", 5),
  page("page-3", "Invoice summary for October", 30, { visibility: "link" }),
  page("page-4", "Hiring pipeline", 80),
];

const MORE = [
  ...PAGES,
  page("page-5", "Weekly metrics", 100),
  page("page-6", "Venue comparison", 120),
  page("page-7", "Support backlog", 150),
  page("page-8", "Roadmap draft", 200),
  page("page-9", "Team birthdays", 260),
];

const meta = {
  title: "Pages/Pages list",
  component: PagesList,
  parameters: {
    layout: "padded",
    api: api({
      pages: {
        list: { items: PAGES, nextCursor: null },
        pin: (input) => ({
          ...PAGES.find((item) => item.id === input.pageId)!,
          pinned: input.pinned,
        }),
        rename: (input) => ({
          ...PAGES.find((item) => item.id === input.pageId)!,
          title: input.title,
        }),
        remove: { ok: true },
      },
    }),
  },
  args: { botId: CHIEF.id },
  decorators: [
    (Story) => (
      <div className="w-[360px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PagesList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Many: Story = {
  parameters: {
    api: api({
      pages: {
        list: (input) =>
          input.cursor
            ? { items: [page("page-10", "Archive index", 400)], nextCursor: null }
            : {
                items: MORE.filter((item) =>
                  item.title.toLowerCase().includes(input.query?.toLowerCase() ?? ""),
                ),
                nextCursor: input.query ? null : "cursor-2",
              },
      },
    }),
  },
};

export const Empty: Story = {
  parameters: { api: api({ pages: { list: { items: [], nextCursor: null } } }) },
};

export const Loading: Story = {
  parameters: { api: api({ pages: { list: () => new Promise(() => {}) } }) },
};

export const CouldNotLoad: Story = {
  parameters: {
    api: api({
      pages: {
        list: () => {
          throw new ORPCError("FORBIDDEN", { message: "Pages are unavailable" });
        },
      },
    }),
  },
};
