import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileBot } from "./api";
import { adoptDeletedSpaceFallback, rpc, selectedSpaceId, selectSpace } from "./api";
import type { InboxSpace } from "./inbox-spaces";
import {
  canDeleteInboxSpace,
  deleteSpaceTitle,
  inboxHasNoChats,
  inboxSignal,
  removeInboxSpace,
  retryInboxSpaceFallback,
  selectInboxSpace,
  spaceInboxItems,
} from "./inbox-spaces";
import { mobileLogoAvatarActivity } from "./logo-avatar-activity";
import { offscreenUnreads } from "./offscreen-unreads";

vi.mock("./api", () => ({
  adoptDeletedSpaceFallback: vi.fn(),
  rpc: vi.fn(),
  selectedSpaceId: vi.fn(),
  selectSpace: vi.fn(),
}));

function space(overrides: Partial<InboxSpace> = {}): InboxSpace {
  return {
    id: "space-work",
    name: "Work",
    isDefault: false,
    hasContent: false,
    canDelete: true,
    bots: [],
    groups: [],
    ...overrides,
  };
}

const bot: MobileBot = {
  id: "bot-1",
  name: "Helper",
  preview: "",
  color: "gray",
  computerMode: "team",
  notifyOnFinish: true,
  threadId: "thread-1",
  status: "idle",
  archivedAt: null,
  unread: false,
  updatedAt: "2026-01-01T00:00:00.000Z",
  modelProvider: null,
  modelId: null,
  thinkingLevel: null,
  autoSpeak: false,
};

describe("spaceInboxItems", () => {
  it("keeps an empty space visible and selectable by its own id", () => {
    const empty = space();
    expect(spaceInboxItems([empty])).toEqual([
      { type: "heading", key: empty.id, title: empty.name, space: empty },
    ]);
  });

  it("keeps the only empty default space visible without offering deletion", () => {
    const personal = space({ isDefault: true, canDelete: true });
    const items = spaceInboxItems([personal]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "heading", space: personal });
    expect(canDeleteInboxSpace(personal)).toBe(false);
    expect(inboxHasNoChats(items)).toBe(true);
  });

  it("keeps populated default-space chrome minimal and retains group rows", () => {
    const group = {
      id: "group-1",
      name: "Planning",
      preview: "",
      archivedAt: null,
      unread: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
      members: [],
    };
    const items = spaceInboxItems([space({ isDefault: true, bots: [bot], groups: [group] })]);
    expect(items.map((item) => item.type)).toEqual(["bot", "group"]);
    expect(items[0]).toMatchObject({ type: "bot", bot });
  });

  it("keeps empty spaces beside a populated space", () => {
    const personal = space({ id: "personal", isDefault: true, bots: [bot] });
    expect(spaceInboxItems([personal, space()]).map((item) => item.type)).toEqual([
      "heading",
      "bot",
      "heading",
    ]);
  });

  it.each([undefined, false])("hides deletion unless ownership is explicit (%s)", (canDelete) => {
    expect(canDeleteInboxSpace(space({ canDelete }))).toBe(false);
  });

  it("offers deletion for an explicitly authorized non-default space", () => {
    expect(canDeleteInboxSpace(space())).toBe(true);
  });

  it("offers deletion for a space that still has bots, which go with it", () => {
    expect(canDeleteInboxSpace(space({ hasContent: true, bots: [bot] }))).toBe(true);
  });

  it("names every bot deletion removes, not only the visible ones", () => {
    expect(deleteSpaceTitle(space({ bots: [bot], botCount: 3 }))).toBe(
      "Delete Work and its 3 bots?",
    );
    expect(deleteSpaceTitle(space({ bots: [], botCount: 1 }))).toBe("Delete Work and its bot?");
    expect(deleteSpaceTitle(space({ bots: [bot], botCount: 0 }))).toBe("Delete Work?");
    // Older servers send no count; fall back to the listed bots.
    expect(deleteSpaceTitle(space({ bots: [bot] }))).toBe("Delete Work and its bot?");
  });

  it("never offers deletion for the default space", () => {
    expect(canDeleteInboxSpace(space({ isDefault: true }))).toBe(false);
  });
});

describe("removeInboxSpace", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(selectedSpaceId).mockReturnValue("space-work");
    vi.mocked(rpc).mockResolvedValue({ ok: true, activeSpaceId: "personal" });
    vi.mocked(selectSpace).mockResolvedValue(true);
    vi.mocked(adoptDeletedSpaceFallback).mockResolvedValue(true);
  });

  it("awaits saving the server fallback before refreshing a deleted current space", async () => {
    let finishSelection!: (saved: boolean) => void;
    vi.mocked(selectSpace).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSelection = resolve;
        }),
    );
    const refresh = vi.fn(async () => undefined);
    const removing = removeInboxSpace("space-work", refresh);
    await vi.waitFor(() => expect(selectSpace).toHaveBeenCalledWith("personal"));
    expect(refresh).not.toHaveBeenCalled();
    finishSelection(true);
    await expect(removing).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledWith("spaces/remove", { spaceId: "space-work" });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps the selection when deleting another space", async () => {
    vi.mocked(selectedSpaceId).mockReturnValue("personal");
    const refresh = vi.fn(async () => undefined);
    await expect(removeInboxSpace("space-work", refresh)).resolves.toBeNull();
    expect(selectSpace).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("adopts and refreshes the server fallback when direct persistence fails", async () => {
    vi.mocked(selectSpace).mockResolvedValue(false);
    const refresh = vi.fn(async () => undefined);
    await expect(removeInboxSpace("space-work", refresh)).resolves.toBeNull();
    expect(adoptDeletedSpaceFallback).toHaveBeenCalledWith("personal");
    expect(refresh).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("retains a retry when neither fallback recovery write is durable", async () => {
    vi.mocked(selectSpace).mockResolvedValue(false);
    vi.mocked(adoptDeletedSpaceFallback).mockResolvedValue(false);
    const refresh = vi.fn(async () => undefined);
    const recoveryId = await removeInboxSpace("space-work", refresh);
    expect(recoveryId).toBe("personal");
    expect(refresh).toHaveBeenCalledOnce();
    vi.mocked(adoptDeletedSpaceFallback).mockResolvedValue(true);
    await expect(retryInboxSpaceFallback(recoveryId!, refresh)).resolves.toBe(true);
    expect(adoptDeletedSpaceFallback).toHaveBeenCalledTimes(2);
    expect(adoptDeletedSpaceFallback).toHaveBeenLastCalledWith("personal");
    expect(selectSpace).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("keeps the retry visible when fallback persistence still fails", async () => {
    vi.mocked(adoptDeletedSpaceFallback).mockResolvedValue(false);
    const refresh = vi.fn(async () => undefined);
    await expect(retryInboxSpaceFallback("personal", refresh)).resolves.toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("selects an empty inbox without creating a bot or starting onboarding", async () => {
    const refresh = vi.fn(async () => undefined);
    await expect(selectInboxSpace("space-work", refresh)).resolves.toBe(true);
    expect(selectSpace).toHaveBeenCalledWith("space-work");
    expect(refresh).toHaveBeenCalledOnce();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not refresh when selecting an empty space fails", async () => {
    vi.mocked(selectSpace).mockResolvedValue(false);
    const refresh = vi.fn(async () => undefined);
    await expect(selectInboxSpace("space-work", refresh)).resolves.toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("also adopts the fallback when native selection throws", async () => {
    vi.mocked(selectSpace).mockRejectedValue(new Error("storage unavailable"));
    const refresh = vi.fn(async () => undefined);
    await expect(removeInboxSpace("space-work", refresh)).resolves.toBeNull();
    expect(adoptDeletedSpaceFallback).toHaveBeenCalledWith("personal");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("leaves selection and inbox unchanged when deletion is rejected", async () => {
    vi.mocked(rpc).mockRejectedValue(new Error("Space is not empty"));
    const refresh = vi.fn(async () => undefined);
    await expect(removeInboxSpace("space-work", refresh)).rejects.toThrow("Space is not empty");
    expect(selectSpace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("inbox attention pills", () => {
  beforeEach(() => mobileLogoAvatarActivity.clear());

  it("does not count a read photo row, which shows no waiting indicator", () => {
    const waiting = {
      ...bot,
      color: "data:image/png;base64,AAAA",
      status: "waiting_input",
    };
    const items = spaceInboxItems([
      space({
        isDefault: true,
        bots: [
          waiting,
          ...Array.from({ length: 20 }, (_, index) => ({ ...bot, id: `loose-${index}` })),
        ],
      }),
    ]);
    const signals = items.map(inboxSignal);
    expect(signals.every((signal) => signal.unread === 0 && signal.attention === 0)).toBe(true);
    expect(offscreenUnreads(signals, { first: 0, last: 0 })).toEqual({
      above: undefined,
      below: undefined,
    });
    expect(offscreenUnreads(signals, { first: 10, last: 20 })).toEqual({
      above: undefined,
      below: undefined,
    });
  });

  it("still jumps to a genuinely waiting avatar above or below the viewport", () => {
    const waiting = { ...bot, status: "waiting_input" };
    const signals = [
      inboxSignal({ type: "heading", key: "custom", title: "Research", space: space() }),
      inboxSignal({ type: "bot", bot: waiting }),
      { unread: 0, attention: 0 },
    ];
    expect(offscreenUnreads(signals, { first: 0, last: 0 }).below).toEqual({
      kind: "attention",
      count: 1,
      index: 1,
    });
    expect(offscreenUnreads(signals, { first: 2, last: 2 }).above).toEqual({
      kind: "attention",
      count: 1,
      index: 1,
    });
  });

  it("honors live activity instead of a stale waiting status", () => {
    mobileLogoAvatarActivity.hydrate("test", {
      threadId: bot.threadId,
      botId: bot.id,
      cursor: 1,
      run: { id: "run", botId: bot.id, status: "running", trigger: "user" },
    });
    const waiting = { ...bot, status: "waiting_input" };
    expect(inboxSignal({ type: "bot", bot: waiting }).attention).toBe(0);
    mobileLogoAvatarActivity.clear();
  });

  it("follows background suppression and live waits without changing unread counts", () => {
    const waiting = { ...bot, status: "waiting_input", unread: true };
    const snapshot = {
      threadId: bot.threadId,
      botId: bot.id,
      cursor: 1,
      run: {
        id: "run",
        botId: bot.id,
        status: "waiting_input" as const,
        trigger: "tickets" as const,
      },
    };
    mobileLogoAvatarActivity.hydrate("test", snapshot);
    expect(inboxSignal({ type: "bot", bot: waiting })).toEqual({ unread: 1, attention: 0 });
    mobileLogoAvatarActivity.hydrate("test", {
      ...snapshot,
      cursor: 2,
      run: { ...snapshot.run, trigger: "user" },
    });
    expect(inboxSignal({ type: "bot", bot: { ...waiting, status: "idle" } })).toEqual({
      unread: 1,
      attention: 1,
    });
    mobileLogoAvatarActivity.clear();
  });
});
