import { afterEach, describe, expect, it, vi } from "vitest";
import { formatActivityRelativeTime, routineRunLateLabel } from "./activity";
import { resetI18nForTests } from "./i18n";

vi.mock("./api", () => ({ rpc: vi.fn() }));
afterEach(() => resetI18nForTests());

describe("formatActivityRelativeTime", () => {
  const now = new Date("2026-01-01T12:00:00.000Z");

  it.each([
    { seconds: 0, label: "just now" },
    { seconds: 44, label: "just now" },
    { seconds: 45, label: "just now" },
    { seconds: 59, label: "just now" },
    { seconds: 59.999, label: "just now" },
    { seconds: 60, label: "1m ago" },
    { seconds: 3_599, label: "59m ago" },
    { seconds: 3_600, label: "1h ago" },
    { seconds: 86_400, label: "1d ago" },
  ])("formats $seconds seconds ago as $label", ({ seconds, label }) => {
    const iso = new Date(now.getTime() - seconds * 1_000).toISOString();
    expect(formatActivityRelativeTime(iso, now)).toBe(label);
  });
});

describe("routineRunLateLabel", () => {
  const run = {
    id: "run-1",
    botId: "bot-1",
    groupId: null,
    status: "completed" as const,
    error: null,
    createdAt: "2026-01-02T12:00:00Z",
    startedAt: "2026-01-02T12:00:00Z",
    lateSince: null,
    completedAt: "2026-01-02T12:01:00Z",
    messageId: null,
  };

  it("labels only a run that started late, in the active language", () => {
    expect(routineRunLateLabel(run)).toBeUndefined();
    expect(routineRunLateLabel({ ...run, lateSince: "2026-01-02T11:40:00Z" })).toBe(
      "Started 20m late",
    );
    expect(routineRunLateLabel({ ...run, lateSince: "2026-01-02T09:30:00Z" })).toBe(
      "Started 2h late",
    );
    resetI18nForTests("de");
    expect(routineRunLateLabel({ ...run, lateSince: "2025-12-30T12:00:00Z" })).toBe(
      "3 T. verspätet gestartet",
    );
  });
});
