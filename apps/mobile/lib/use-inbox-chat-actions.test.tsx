// @vitest-environment jsdom

import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MobileBot, MobileGroup } from "./api";
import { rpc } from "./api";
import { confirmDeleteBot, confirmDeleteGroup } from "./bot-lifecycle";
import type { InboxRowAction } from "./inbox-swipe";
import { applyUnreadOverrides } from "./inbox-swipe";
import { afterChatNotifyChange, dismissThreadNotifications } from "./live-notifications";
import { useInboxChatActions } from "./use-inbox-chat-actions";

const session = vi.hoisted(() => ({ space: "space-a", generation: 1, alert: vi.fn() }));

vi.mock("react-native", () => ({ Alert: { alert: session.alert } }));
vi.mock("./api", () => ({
  captureApiRequestContext: async () => ({
    apiBase: "",
    headers: { authorization: "Bearer token", "x-rakazo-space-id": session.space },
    sessionGeneration: session.generation,
  }),
  currentApiBase: () => "",
  loadSessionToken: async () => null,
  rpc: vi.fn(),
  selectedSpaceId: () => session.space,
}));
vi.mock("./bot-lifecycle", () => ({ confirmDeleteBot: vi.fn(), confirmDeleteGroup: vi.fn() }));
vi.mock("./i18n", () => {
  const i18n = { t: (text: string) => text };
  return { useI18n: () => i18n };
});
vi.mock("./live-notifications", () => ({
  afterChatNotifyChange: vi.fn(async () => {}),
  dismissThreadNotifications: vi.fn(async () => {}),
}));
vi.mock("./session", () => ({ currentSessionGeneration: () => session.generation }));
vi.mock("./user-error", () => ({ errorText: (_error: unknown, fallback: string) => fallback }));

type Actions = ReturnType<typeof useInboxChatActions>;
type Chat = { id: string; name?: string; spaceId?: string; threadId?: string };

let root: Root | undefined;
const sent = (call: unknown[]) => call.slice(0, 2);

beforeEach(() => {
  session.space = "space-a";
  session.generation = 1;
  vi.clearAllMocks();
});

afterEach(() => {
  root?.unmount();
  root = undefined;
});

async function handlers(
  respond: (procedure: string, input: unknown, options?: unknown) => Promise<unknown>,
) {
  vi.mocked(rpc).mockImplementation(respond as typeof rpc);
  const lists = {
    bots: [{ id: "b1", unread: false }] as MobileBot[],
    groups: [{ id: "g1", unread: true }] as MobileGroup[],
  };
  const update =
    <K extends keyof typeof lists>(key: K) =>
    (next: (typeof lists)[K] | ((current: (typeof lists)[K]) => (typeof lists)[K])) => {
      lists[key] = typeof next === "function" ? next(lists[key]) : next;
    };
  const loadBots = vi.fn<() => Promise<unknown>>(async () => {});
  let actions: Actions | undefined;
  function Harness() {
    actions = useInboxChatActions({
      loadBots,
      setBots: update("bots"),
      setGroups: update("groups"),
    });
    return null;
  }
  const container = document.createElement("div");
  root = createRoot(container);
  root.render(<Harness />);
  await vi.waitFor(() => expect(actions).toBeDefined());
  const current = () => actions!;
  return {
    loadBots,
    state: Object.defineProperties(lists, {
      // The hook's own state, as last rendered.
      overrides: { get: () => current().unreadOverrides },
    }) as typeof lists & { overrides: ReadonlyMap<string, boolean> },
    runRowAction: (kind: "bot" | "group", chat: Chat, action: InboxRowAction) =>
      current().runRowAction(kind, chat as MobileBot, action),
    setNotifyOnFinish: (kind: "bot" | "group", chat: Chat, notify: boolean) =>
      current().setNotifyOnFinish(kind, chat as MobileBot, notify),
  };
}

it("reports a saved bot mute even when its inbox row has no thread id", async () => {
  const actions = await handlers(async () => undefined);
  await actions.setNotifyOnFinish("bot", { id: "b1", spaceId: "space-a" }, false);
  expect(afterChatNotifyChange).toHaveBeenCalledExactlyOnceWith("", null, "space-a", {
    botId: "b1",
    threadId: undefined,
    notify: false,
  });
});

it("does not report a bot mute when the server save fails", async () => {
  const actions = await handlers(async () => {
    throw new Error("offline");
  });
  await expect(
    actions.setNotifyOnFinish("bot", { id: "b1", spaceId: "space-a" }, false),
  ).rejects.toThrow("offline");
  expect(afterChatNotifyChange).not.toHaveBeenCalled();
});

it("sends overlapping read changes for one chat in order and keeps the newest on screen", async () => {
  const pending: Array<() => void> = [];
  const h = await handlers(() => new Promise<void>((resolve) => pending.push(resolve)));
  const first = h.runRowAction("bot", { id: "b1" }, "unread");
  const second = h.runRowAction("bot", { id: "b1" }, "read");
  await second;
  // The second change waits for the first instead of racing it.
  await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  expect(sent(vi.mocked(rpc).mock.calls[0]!)).toEqual(["threads/markUnread", { botId: "b1" }]);
  await vi.waitFor(() => expect(h.state.overrides.get("bot:b1")).toBe(false));
  pending.shift()!();
  await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
  expect(sent(vi.mocked(rpc).mock.calls[1]!)).toEqual(["threads/markRead", { botId: "b1" }]);
  // The first request finishing must not clear the newer choice.
  expect(h.state.overrides.get("bot:b1")).toBe(false);
  pending.shift()!();
  await first;
  expect(h.state.bots[0]!.unread).toBe(false);
  await vi.waitFor(() => expect(h.state.overrides.size).toBe(0));
});

it("clears a chat's delivered notifications when it is marked read, not unread", async () => {
  const h = await handlers(async () => undefined);
  await h.runRowAction("bot", { id: "b1", threadId: "thread-b1" }, "read");
  await h.runRowAction("bot", { id: "b2" }, "read");
  await h.runRowAction("group", { id: "g1" }, "read");
  await h.runRowAction("bot", { id: "b1" }, "unread");
  expect(vi.mocked(dismissThreadNotifications).mock.calls).toEqual([
    [{ threadId: "thread-b1" }],
    [{ botId: "b2" }],
    [{ groupId: "g1" }],
  ]);
});

it("drops a change that is undone before its turn", async () => {
  const pending: Array<() => void> = [];
  const h = await handlers(() => new Promise<void>((resolve) => pending.push(resolve)));
  const first = h.runRowAction("group", { id: "g1" }, "read");
  void h.runRowAction("group", { id: "g1" }, "unread");
  void h.runRowAction("group", { id: "g1" }, "read");
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  pending.shift()!();
  await first;
  expect(vi.mocked(rpc).mock.calls.map(sent)).toEqual([["threads/markRead", { groupId: "g1" }]]);
  expect(h.state.groups[0]!.unread).toBe(false);
  await vi.waitFor(() => expect(h.state.overrides.size).toBe(0));
});

it("sends a queued change in the Space it was swiped in after a Space switch", async () => {
  const pending: Array<() => void> = [];
  const h = await handlers(() => new Promise<void>((resolve) => pending.push(resolve)));
  const first = h.runRowAction("bot", { id: "b1" }, "unread");
  void h.runRowAction("bot", { id: "b1" }, "read");
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  session.space = "space-b";
  pending.shift()!();
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  const spaces = vi
    .mocked(rpc)
    .mock.calls.map(
      (call) =>
        (call[2] as { requestContext: { headers: Record<string, string> } }).requestContext.headers[
          "x-rakazo-space-id"
        ],
    );
  expect(spaces).toEqual(["space-a", "space-a"]);
  pending.shift()!();
  await first;
});

it("drops queued changes quietly once the session changes", async () => {
  const pending: Array<() => void> = [];
  const h = await handlers(() => new Promise<void>((resolve) => pending.push(resolve)));
  const first = h.runRowAction("bot", { id: "b1" }, "unread");
  void h.runRowAction("bot", { id: "b1" }, "read");
  await vi.waitFor(() => expect(pending).toHaveLength(1));
  session.generation = 2;
  pending.shift()!();
  await first;
  expect(rpc).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(h.state.overrides.size).toBe(0));
  expect(session.alert).not.toHaveBeenCalled();
});

it("marks unread optimistically, keeps it through the request, then refreshes", async () => {
  let finish!: () => void;
  const h = await handlers(() => new Promise<void>((resolve) => (finish = resolve)));
  const pending = h.runRowAction("bot", { id: "b1" }, "unread");
  await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  expect(sent(vi.mocked(rpc).mock.calls[0]!)).toEqual(["threads/markUnread", { botId: "b1" }]);
  await vi.waitFor(() => expect(h.state.overrides.get("bot:b1")).toBe(true));
  // A poll landing now still shows the stale server value underneath the override.
  expect(applyUnreadOverrides("bot", h.state.bots, h.state.overrides)[0]!.unread).toBe(true);
  finish();
  await pending;
  expect(h.state.bots[0]!.unread).toBe(true);
  expect(h.loadBots).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(h.state.overrides.size).toBe(0));
  expect(session.alert).not.toHaveBeenCalled();
});

it("rolls a failed read change back and uses the native alert", async () => {
  const h = await handlers(async () => {
    throw new Error("offline");
  });
  await h.runRowAction("group", { id: "g1" }, "read");
  expect(sent(vi.mocked(rpc).mock.calls[0]!)).toEqual(["threads/markRead", { groupId: "g1" }]);
  await vi.waitFor(() => expect(h.state.overrides.size).toBe(0));
  expect(h.state.groups[0]!.unread).toBe(true);
  expect(session.alert).toHaveBeenCalledWith("Could not update chat", "Try again.");
});

it.each([
  ["bot", confirmDeleteBot],
  ["group", confirmDeleteGroup],
] as const)(
  "%s delete asks with the chat's own confirmation and refreshes once deleted",
  async (kind, confirm) => {
    const h = await handlers(async () => ({ ok: true }));
    await h.runRowAction(kind, { id: "x", name: "Ada" }, "delete");
    // Nothing is removed until the alert is confirmed.
    expect(rpc).not.toHaveBeenCalled();
    expect(h.loadBots).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith({ id: "x", name: "Ada" }, expect.any(Function));
    vi.mocked(confirm).mock.calls[0]![1]!();
    expect(h.loadBots).toHaveBeenCalledTimes(1);
  },
);

it("marks a chat from another space read in that space", async () => {
  const h = await handlers(async () => ({ ok: true }));
  await h.runRowAction("bot", { id: "x", spaceId: "space-b" }, "read");
  expect(vi.mocked(rpc).mock.calls[0]?.[2]).toMatchObject({
    requestContext: { headers: { "x-rakazo-space-id": "space-b" } },
  });
});

it("updates a chat from another space in that space without switching", async () => {
  const h = await handlers(async () => ({ ok: true }));
  await h.setNotifyOnFinish("bot", { id: "x", spaceId: "space-b" }, false);
  expect(vi.mocked(rpc).mock.calls).toEqual([
    [
      "bots/update",
      { botId: "x", notifyOnFinish: false },
      {
        requestContext: {
          apiBase: "",
          headers: { authorization: "Bearer token", "x-rakazo-space-id": "space-b" },
          sessionGeneration: 1,
        },
        skipSpaceAuthRecovery: true,
      },
    ],
  ]);
  expect(h.loadBots).toHaveBeenCalledTimes(1);
});
