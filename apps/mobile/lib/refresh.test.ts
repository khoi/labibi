import { describe, expect, it } from "vitest";
import { threadRefreshDelayMs } from "./refresh";

describe("thread refresh cadence", () => {
  it("keeps an active run covered without a live subscription on a slow safety poll", () => {
    expect(threadRefreshDelayMs("running")).toBe(10_000);
    expect(threadRefreshDelayMs("queued", { liveSubscribed: false })).toBe(10_000);
    expect(threadRefreshDelayMs("leased", { liveSubscribed: false })).toBe(10_000);
    expect(threadRefreshDelayMs("waiting_input")).toBe(60_000);
    expect(threadRefreshDelayMs(undefined)).toBe(60_000);
  });

  it("trusts live events for active runs and keeps idle chats quiet", () => {
    expect(threadRefreshDelayMs("running", { liveSubscribed: true })).toBe(30_000);
    expect(threadRefreshDelayMs("queued", { liveSubscribed: true })).toBe(30_000);
    expect(threadRefreshDelayMs("leased", { liveSubscribed: true })).toBe(30_000);
    expect(threadRefreshDelayMs("waiting_input", { liveSubscribed: true })).toBe(60_000);
    expect(threadRefreshDelayMs(undefined, { liveSubscribed: true })).toBe(60_000);
  });
});
