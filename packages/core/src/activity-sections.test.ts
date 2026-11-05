import type { RunStatus } from "@labradoodle/contracts";
import { expect, it } from "vitest";
import { activityAttention, activitySections } from "./activity-sections.js";
import { STUCK_WORK_NOTIFY_AFTER_MS } from "./stuck-work.js";

const now = new Date().toISOString();
const run = (threadId: string, status: RunStatus, updatedAt = now) =>
  ({ threadId, status, updatedAt }) as const;

it.each([
  ["waiting_input", false, "needs_attention"],
  ["waiting_takeover", false, "needs_attention"],
  ["failed", true, "needs_attention"],
  ["failed", false, null],
  ["running", true, "working"],
  ["queued", false, "working"],
  ["completed", true, "unread"],
  ["cancelled", false, null],
] as const)("classifies %s (unread %s) as %s", (status, unread, state) => {
  expect(activityAttention(run("bot", status), unread)).toBe(state);
});

it("calls out a queue that has sat past the reminder", () => {
  const old = new Date(Date.now() - STUCK_WORK_NOTIFY_AFTER_MS).toISOString();
  expect(activityAttention(run("bot", "queued", old))).toBe("needs_attention");
});

it("puts each conversation in one section", () => {
  const ask = run("marketing", "waiting_input");
  const work = run("launch", "running");
  const failedUnread = run("writer", "failed");
  const done = run("editor", "completed");
  const doneUnread = run("chief", "completed");
  const sections = activitySections({
    active: [ask, work],
    recent: [failedUnread, done, doneUnread],
    chats: [
      { id: "research", unread: true },
      { id: "writer", unread: true },
      { id: "editor", unread: false },
      { id: "chief", unread: true },
      { id: "marketing", unread: true },
      { id: "launch", unread: true },
    ],
  });
  expect(sections.attention).toEqual([ask, failedUnread]);
  expect(sections.working).toEqual([work]);
  expect(sections.unreadChats.map((chat) => chat.id)).toEqual(["research", "chief"]);
  expect(sections.recent).toEqual([done]);
});

it("judges a chat by its latest run only", () => {
  const sections = activitySections({
    active: [],
    recent: [run("writer", "completed"), run("writer", "failed"), run("editor", "failed")],
    chats: [
      { id: "writer", unread: true },
      { id: "editor", unread: true },
      { id: "chief", unread: true },
    ],
  });
  expect(sections.attention).toEqual([run("editor", "failed")]);
  // A failure older than the fetched runs still leaves the chat under Unread.
  expect(sections.unreadChats.map((chat) => chat.id)).toEqual(["writer", "chief"]);
});

it("lets live work speak for a chat over its older outcome", () => {
  const working = run("writer", "running");
  const asking = run("launch", "waiting_input");
  const sections = activitySections({
    active: [working, run("launch", "running"), asking],
    recent: [run("writer", "failed"), run("launch", "failed")],
    chats: [
      { id: "writer", unread: true },
      { id: "launch", unread: true },
    ],
  });
  expect(sections.attention).toEqual([asking]);
  expect(sections.working).toEqual([working]);
  expect(sections.unreadChats).toEqual([]);
});
