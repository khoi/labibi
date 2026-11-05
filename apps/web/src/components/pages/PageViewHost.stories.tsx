import type { PageDetail } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { createPageSession, PagesProvider } from "../../lib/pages";
import { api } from "../../storybook/api";
import { CHIEF, NOW } from "../../storybook/fixtures";
import { PAGE_CODE } from "../../storybook/pages";
import { PageViewHost } from "./PageViewHost";

const PAGE: PageDetail = {
  id: "page-1",
  title: "Q3 launch tracker",
  botId: CHIEF.id,
  groupId: null,
  visibility: "link",
  currentVersion: 3,
  version: 3,
  pinned: false,
  createdAt: NOW,
  updatedAt: NOW,
  code: PAGE_CODE,
  owner: { name: "Ada Park", image: null },
  shareUrl: null,
};

function withPages(share: boolean): Decorator {
  return (Story) => {
    const [session] = useState(() => {
      const created = createPageSession();
      if (share) created.askShare(PAGE.id);
      return created;
    });
    return (
      <PagesProvider value={{ open: fn(), session }}>
        <div className="h-dvh bg-background" />
        <Story />
      </PagesProvider>
    );
  };
}

const failWith = (code: "NOT_FOUND" | "BAD_REQUEST") =>
  api({
    pages: {
      get: () => {
        throw new ORPCError(code, { message: "Page could not be read" });
      },
    },
  });

const meta = {
  title: "Pages/Page view host",
  component: PageViewHost,
  decorators: [withPages(false)],
  parameters: {
    route: `/app/${CHIEF.id}?page=${PAGE.id}`,
    api: api({
      pages: {
        get: (input) => ({
          ...PAGE,
          shareUrl: input.link ? "https://labradoodle.example.test/p/q3-launch-tracker" : null,
        }),
        rename: (input) => ({ ...PAGE, title: input.title }),
        setVisibility: (input) => ({ visibility: input.visibility, shareUrl: null }),
      },
    }),
  },
} satisfies Meta<typeof PageViewHost>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};

export const ShareRequested: Story = { decorators: [withPages(true)] };

export const NotAvailable: Story = { parameters: { api: failWith("NOT_FOUND") } };

export const CouldNotLoad: Story = { parameters: { api: failWith("BAD_REQUEST") } };
