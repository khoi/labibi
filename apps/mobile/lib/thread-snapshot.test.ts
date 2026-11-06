import { reduceLiveMessageBlocks, withLiveStreamingProgress } from "@labradoodle/core";
import { describe, expect, it } from "vitest";
import type { MobileSnapshot } from "./api";
import { reconcileVisibleThreadSnapshot } from "./thread-snapshot";

function snapshot(): MobileSnapshot {
  return {
    chat: {
      id: "thread-1",
      spaceId: "space-1",
      name: null,
      title: "",
      doodle: true,
      members: [],
      preview: "",
      status: "idle",
      unread: false,
      muted: false,
      lastReadSeq: -1,
      lastMessageAt: "",
      createdAt: "",
    },
    threadId: "thread-1",
    cursor: 0,
    messages: [],
    olderCursor: null,
    run: { id: "run-1", status: "running" },
  };
}

describe("visible thread snapshot publication", () => {
  it("models 200 progress events with five visible changes as 200 commits before and five after", () => {
    let raw = snapshot();
    let before = raw;
    let after = raw;
    let beforeCommits = 0;
    let afterCommits = 0;
    for (let event = 1; event <= 200; event += 1) {
      raw = {
        ...raw,
        cursor: event,
        messages: [
          {
            id: "progress:run-1",
            role: "bot",
            blocks: reduceLiveMessageBlocks(raw.messages[0]?.blocks ?? [], {
              type: "progress",
              payload: { text: `Stage ${Math.ceil(event / 40)}`, activity: true },
            }),
          },
        ],
      };
      const visible = withLiveStreamingProgress(raw, false)!;
      if (before !== visible) beforeCommits += 1;
      before = visible;
      const reconciled = reconcileVisibleThreadSnapshot(after, visible)!;
      if (after !== reconciled) afterCommits += 1;
      after = reconciled;
      expect(after.messages).toEqual(before.messages);
      expect(after.run).toEqual(before.run);
    }
    expect({ beforeCommits, afterCommits }).toEqual({ beforeCommits: 200, afterCommits: 5 });
    expect(raw.cursor).toBe(200);
  });

  it("ignores hidden text but publishes each changed text value when streaming is enabled", () => {
    const initial = snapshot();
    let streaming: MobileSnapshot = initial;
    for (let event = 1; event <= 200; event += 1) {
      const raw: MobileSnapshot = {
        ...initial,
        cursor: event,
        messages: [
          { id: "progress:run-1", role: "bot", blocks: [{ kind: "progress", text: `${event}` }] },
        ],
      };
      expect(reconcileVisibleThreadSnapshot(initial, withLiveStreamingProgress(raw, false))).toBe(
        initial,
      );
      expect(reconcileVisibleThreadSnapshot(streaming, withLiveStreamingProgress(raw, true))).toBe(
        raw,
      );
      streaming = raw;
    }
    expect(
      reconcileVisibleThreadSnapshot(streaming, withLiveStreamingProgress(streaming, false)),
    ).toEqual({ ...streaming, messages: [] });
  });
});
