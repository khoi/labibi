import { describe, expect, it } from "vitest";
import { buildApprovalAskBlock } from "./approval-ask.js";

describe("buildApprovalAskBlock", () => {
  it("binds the approval to its effect and redacts secrets", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "gmail_send_email",
      { to: "person@example.test", body: "token-secret" },
      ["token-secret"],
    );

    expect(block).toMatchObject({
      kind: "ask",
      approvalEffectId: "effect-1",
      actions: [
        { id: "allow", label: "Allow once" },
        { id: "always", label: "Always allow this tool" },
        { id: "deny", label: "Deny" },
      ],
    });
    expect(JSON.stringify(block)).not.toContain("token-secret");
  });

  it("bounds model-controlled summaries and details", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "destination.write",
      { title: "t".repeat(1_000), body: "b".repeat(10_000) },
      [],
    );

    expect(block.kind).toBe("ask");
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.text.length).toBeLessThanOrEqual(501);
    expect(block.detail?.length).toBeLessThanOrEqual(4_001);
  });

  it("includes an optional review reason as the first detail line", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "gmail_send_email",
      { to: "person@example.test", subject: "Hi" },
      [],
      { reviewReason: "Sends email outside the draft-only task." },
    );

    expect(block.kind).toBe("ask");
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.detail?.startsWith("Sends email outside the draft-only task.")).toBe(true);
    expect(block.detail).toContain("to: person@example.test");
  });
});

it("shows the full instruction replacement as a diff with Apply and Dismiss", () => {
  const block = buildApprovalAskBlock(
    "effect-1",
    "update_bot",
    {
      botId: "bot-1",
      previousInstructions: "Draft only",
      previousInstructionsFromBaseline: true,
      instructions: "Draft only\nAsk before sending",
      reason: "Learned preference",
    },
    [],
  );
  expect(block).toMatchObject({
    kind: "ask",
    detail: "- Draft only\n+ Draft only\n+ Ask before sending",
    instructionUpdate: {
      botId: "bot-1",
      before: "Draft only",
      after: "Draft only\nAsk before sending",
    },
    actions: [
      { id: "allow", label: "Apply" },
      { id: "deny", label: "Dismiss" },
    ],
  });
  // The stored provenance marker is not card copy.
  expect(JSON.stringify(block)).not.toContain("previousInstructionsFromBaseline");
});

it("redacts known secrets in instruction approval details and editable metadata", () => {
  const block = buildApprovalAskBlock(
    "effect-1",
    "update_bot",
    {
      botId: "bot-1",
      previousInstructions: "old fake-token",
      instructions: "new fake-token",
      reason: "reason fake-token",
    },
    ["fake-token"],
  );
  expect(JSON.stringify(block)).not.toContain("fake-token");
});

it("shows a bot's first instructions as plain text", () => {
  const block = buildApprovalAskBlock(
    "effect-1",
    "update_bot",
    { botId: "bot-1", previousInstructions: "", instructions: "Draft only", reason: "Set in chat" },
    [],
  );
  expect(block).toMatchObject({ detail: "Draft only" });
});

describe("approval card arguments", () => {
  const detailOf = (toolName: string, args: Record<string, unknown>) => {
    const block = buildApprovalAskBlock("effect-1", toolName, args, []);
    if (block.kind !== "ask") throw new Error("expected ask block");
    return block.detail ?? "";
  };

  it.each([
    [
      "GMAIL_SEND_EMAIL",
      { recipient_email: "a@example.test", to_email: "b@example.test" },
      "to_email: b@example.test",
    ],
    [
      "GOOGLECALENDAR_CREATE_EVENT",
      { summary: "Sync", attendees: ["c@example.test", "d@example.test"] },
      "attendees: c@example.test, d@example.test",
    ],
    [
      "GMAIL_SEND_EMAIL",
      { to: "a@example.test", extra_recipients: ["e@example.test"] },
      "extra_recipients: e@example.test",
    ],
    ["SLACK_SEND_MESSAGE", { channel: "C-OUTSIDE", text: "Hello" }, "channel: C-OUTSIDE"],
    [
      "GITHUB_CREATE_AN_ISSUE",
      { owner: "someone-else", repo: "public-repo", title: "Notes" },
      "repo: public-repo",
    ],
    [
      "SEND_WEBHOOK",
      { destination: { url: "https://hooks.example.test/x" } },
      'destination: {"url":"https://hooks.example.test/x"}',
    ],
  ])("shows where %s sends", (toolName, args, line) => {
    expect(detailOf(toolName, args).split("\n")).toContain(line);
  });

  it("puts every destination above long text, so none sits below a long body", () => {
    const detail = detailOf("GMAIL_SEND_EMAIL", {
      body: "b".repeat(5_000),
      to: "a@example.test",
      bcc: "hidden@example.test",
    });
    expect(detail.split("\n").slice(0, 2)).toEqual([
      "to: a@example.test",
      "bcc: hidden@example.test",
    ]);
    expect(detail.length).toBeLessThanOrEqual(4_001);
  });

  it("puts long recipient lists above long text", () => {
    const recipients = Array.from({ length: 40 }, (_, index) => ({
      email: `r${index}@example.test`,
    }));
    const detail = detailOf("SEND_CAMPAIGN", { body: "b".repeat(5_000), recipients });
    expect(detail.startsWith("recipients: [")).toBe(true);
  });

  it("shows a later batched action's destination above an earlier action's long text", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "MULTI_EXECUTE",
      {
        tools: [
          { tool_slug: "DRAFT_POST", arguments: { body: "b".repeat(5_000) } },
          { tool_slug: "GMAIL_SEND_EMAIL", arguments: { to_email: "g@example.test" } },
        ],
      },
      [],
      { batch: { items: "tools", action: "tool_slug", arguments: "arguments" } },
    );
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.detail?.split("\n").slice(0, 3)).toEqual([
      "DRAFT_POST",
      "GMAIL_SEND_EMAIL",
      "to_email: g@example.test",
    ]);
  });

  it("redacts a secret inside a nested argument even when encoding escapes it", () => {
    const secret = 'p"ss\\word';
    const block = buildApprovalAskBlock(
      "effect-1",
      "CALL_API",
      { headers: { authorization: secret }, to: "h@example.test" },
      [secret],
    );
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.detail).not.toContain("ss");
    expect(block.detail).toContain("to: h@example.test");
  });

  it("shows each batched action's destinations", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "MULTI_EXECUTE",
      { tools: [{ tool_slug: "GMAIL_SEND_EMAIL", arguments: { to_email: "f@example.test" } }] },
      [],
      { batch: { items: "tools", action: "tool_slug", arguments: "arguments" } },
    );
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.detail?.split("\n")).toContain("to_email: f@example.test");
  });
});
