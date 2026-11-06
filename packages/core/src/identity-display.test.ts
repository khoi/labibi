import { describe, expect, it } from "vitest";
import { projectMessages } from "./events.js";
import { displayIdentityEvent, displayIdentityResult } from "./identity-display.js";
import { identitySource } from "./identity-source.js";

const labels = {
  workspace: "Пространство",
  routine: "Задача",
  member: "Участник",
  subagent: "субагент",
};

describe("localized identity projections", () => {
  it("localizes invalid names without translating legitimate names or mutating wire values", () => {
    const source = [
      {
        id: "chat-1",
        members: [
          { name: "Ada", userId: "user-1" },
          { name: "__TestTok2__", userId: "user-2" },
        ],
      },
    ];
    expect(displayIdentityResult(["threads", "list"], source, labels)).toMatchObject([
      {
        ...source[0],
        members: [
          { name: "Ada", userId: "user-1" },
          { name: "Участник", userId: "user-2" },
        ],
      },
    ]);
    expect(source[0]?.members[1]?.name).toBe("__TestTok2__");
  });
  it("covers bootstrap, threads and activity without touching message text or IDs", () => {
    const message = {
      blocks: [{ kind: "text", text: "Keep __TestTok1__ literal" }],
    };
    expect(
      displayIdentityResult(
        ["bootstrap"],
        {
          workspaces: [{ name: "__TestTok1__" }],
          chats: [{ members: [{ name: "" }] }],
          thread: { messages: [message] },
        },
        labels,
      ),
    ).toMatchObject({
      workspaces: [{ name: "Пространство" }],
      chats: [{ members: [{ name: "Участник" }] }],
      thread: {
        messages: [
          {
            blocks: [{ text: "Keep __TestTok1__ literal" }],
          },
        ],
      },
    });
  });
  it("leaves provider configuration and file metadata alone", () => {
    const result = { name: "__TestTok1__", content: { botName: "__TestTok1__" } };
    expect(displayIdentityResult(["artifacts", "get"], result, labels)).toBe(result);
  });
  it("uses the current client locale for streamed metadata", () => {
    expect(
      displayIdentityEvent({ type: "thread.subagent", payload: { name: "__TestTok1__" } }, labels)
        .payload.name,
    ).toBe("субагент");
  });
});

it("keeps server-projected subagent names localizable at the client boundary", () => {
  const messages = projectMessages([
    {
      id: "event",
      createdAt: "2026-01-01T00:00:00.000Z",
      runId: "run",
      threadId: "thread",
      seq: 1,
      type: "thread.subagent",
      payload: { agentId: "agent", name: "__TestTok1__", task: "Summarize" },
    },
  ]);
  expect(messages[0]?.blocks[0]).toMatchObject({ name: "__TestTok1__" });
  expect(displayIdentityResult(["threads", "get"], { messages }, labels)).toMatchObject({
    messages: [{ blocks: [{ name: "субагент" }] }],
  });
});

it("guards routine search titles while preserving link URLs", () => {
  const result = displayIdentityResult(
    ["search", "query"],
    {
      hits: [
        { kind: "routine", title: "__TestTok1__" },
        { kind: "link", title: "https://example.com/__TestTok1__" },
      ],
    },
    labels,
  );
  expect(result).toMatchObject({
    hits: [{ title: "Задача" }, { title: "https://example.com/__TestTok1__" }],
  });
});

it("keeps source names through live subagent projection and object spreads", () => {
  const event = displayIdentityEvent(
    {
      id: "event",
      threadId: "thread",
      seq: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      type: "thread.subagent",
      payload: { agentId: "agent", name: "__TestTok1__", task: "Summarize" },
    },
    labels,
  );
  const messages = projectMessages([event]);
  expect(messages[0]?.blocks[0]).toMatchObject({ kind: "subagent", name: "субагент" });
  const block = { ...messages[0]!.blocks[0]! };
  expect(identitySource(block)).toMatchObject({ kind: "subagent", name: "__TestTok1__" });
  expect(identitySource({ ...block, name: "Ada" })).toMatchObject({ name: "Ada" });
});
