import type { PageDetail } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../../storybook/api";
import { CHIEF, NOW } from "../../storybook/fixtures";
import { PAGE_CODE } from "../../storybook/pages";
import { PageBlockCard } from "./PageBlockCard";

const PAGE: PageDetail = {
  id: "page-1",
  title: "Q3 launch tracker",
  botId: CHIEF.id,
  groupId: null,
  visibility: "private",
  currentVersion: 3,
  version: 3,
  pinned: false,
  createdAt: NOW,
  updatedAt: NOW,
  code: PAGE_CODE,
  owner: { name: "Ada Park", image: null },
  shareUrl: null,
};

const meta = {
  title: "Pages/Page block card",
  component: PageBlockCard,
  parameters: {
    layout: "padded",
    api: api({
      pages: { get: (input) => ({ ...PAGE, version: input.version ?? PAGE.currentVersion }) },
    }),
  },
  args: {
    block: { kind: "page", pageId: PAGE.id, version: 3, title: PAGE.title },
    updated: false,
  },
} satisfies Meta<typeof PageBlockCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Current: Story = {};

export const Shared: Story = {
  parameters: { api: api({ pages: { get: { ...PAGE, visibility: "link" } } }) },
};

export const OlderVersion: Story = {
  args: {
    block: { kind: "page", pageId: PAGE.id, version: 1, title: "Launch tracker" },
    updated: true,
  },
};

export const Loading: Story = {
  parameters: { api: api({ pages: { get: () => new Promise(() => {}) } }) },
};

export const Deleted: Story = {
  parameters: {
    api: api({
      pages: {
        get: () => {
          throw new ORPCError("NOT_FOUND", { message: "Page not found" });
        },
      },
    }),
  },
};
