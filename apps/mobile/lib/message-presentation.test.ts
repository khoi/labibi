import type { MessageBlock } from "@labradoodle/contracts";
import { describe, expect, it } from "vitest";
import {
  hasVisibleMessagePresentation,
  messageHasInlineControls,
  messagePresentationSegments,
  quotableMessageSegments,
  threadCardWidth,
} from "./message-presentation";

describe("mobile message presentation", () => {
  it("hides completed tool activity", () => {
    const blocks = [
      {
        kind: "steps",
        steps: [
          { label: "Read file", count: 1 },
          { label: "Message bot", count: 1 },
        ],
      },
      { kind: "bot_message_sent", toBotId: "b", toBotName: "Research", text: "Go" },
    ] as MessageBlock[];

    expect(messagePresentationSegments(blocks)).toEqual([
      {
        kind: "content",
        blocks: [{ kind: "bot_message_sent", toBotId: "b", toBotName: "Research", text: "Go" }],
      },
    ]);
    expect(
      hasVisibleMessagePresentation([
        { kind: "steps", steps: [{ label: "Message bot", count: 1 }] },
      ]),
    ).toBe(false);
  });

  it("hides marked activity without treating Using narration as a tool", () => {
    const activity = { kind: "progress", text: "Using browser", activity: true } as const;
    const narration = { kind: "progress", text: "Using browser is optional." } as const;

    expect(messagePresentationSegments([activity, narration])).toEqual([
      { kind: "content", blocks: [narration] },
    ]);

    const mixed: Extract<MessageBlock, { kind: "progress" }> = {
      kind: "progress",
      text: "Let me check",
      pendingToolNames: ["browser"],
    };
    expect(messagePresentationSegments([mixed])).toEqual([{ kind: "content", blocks: [mixed] }]);
  });

  it("keeps only response content around tool activity", () => {
    const tool: Extract<MessageBlock, { kind: "steps" }> = {
      kind: "steps",
      steps: [{ label: "Read file", count: 1 }],
    };

    expect(
      messagePresentationSegments([
        { kind: "text", text: "Checking." },
        tool,
        { kind: "text", text: "Done." },
      ]),
    ).toEqual([
      {
        kind: "content",
        blocks: [
          { kind: "text", text: "Checking." },
          { kind: "text", text: "Done." },
        ],
      },
    ]);

    expect(
      messagePresentationSegments([
        { kind: "steps", steps: [{ label: "Message bot", count: 1 }] },
        { kind: "text", text: "Done." },
      ]),
    ).toEqual([{ kind: "content", blocks: [{ kind: "text", text: "Done." }] }]);
  });

  it("sizes thread cards to the bot row, capped on wide screens", () => {
    expect(threadCardWidth(393)).toBe(317);
    expect(threadCardWidth(1024)).toBe(340);
  });

  it("keeps the computer takeover card out of the text bubble", () => {
    const computer: Extract<MessageBlock, { kind: "computer" }> = {
      kind: "computer",
      state: "Needs you",
      text: "Sign in to continue.",
    };

    expect(messagePresentationSegments([computer])).toEqual([]);
    expect(hasVisibleMessagePresentation([computer])).toBe(true);
    expect(messagePresentationSegments([{ kind: "text", text: "Opening." }, computer])).toEqual([
      { kind: "content", blocks: [{ kind: "text", text: "Opening." }] },
    ]);
  });
});

describe("quotableMessageSegments", () => {
  it("exposes the server's visible text, not the typographer-rendered glyphs", () => {
    // Bubbles render `—`, curly quotes, and `…`; the server validates against
    // the raw visible text, so the sheet must offer the untransformed glyphs.
    const segments = quotableMessageSegments("bot", [
      {
        kind: "text",
        text: 'run `pnpm dev -- --watch` ... say "hi" -- soon...',
      } as MessageBlock,
    ]);
    expect(segments).toEqual(['run pnpm dev -- --watch ... say "hi" -- soon...']);
  });

  it("keeps user text verbatim since replies validate it as plain text", () => {
    const segments = quotableMessageSegments("user", [
      { kind: "text", text: "look at **this** commit" } as MessageBlock,
    ]);
    expect(segments).toEqual(["look at **this** commit"]);
  });

  it("keeps text blocks as separate segments and drops non-text blocks", () => {
    const segments = quotableMessageSegments("bot", [
      { kind: "text", text: "first" } as MessageBlock,
      {
        kind: "image",
        artifactId: "a1",
        mimeType: "image/png",
        name: "x.png",
      } as MessageBlock,
      { kind: "text", text: "   " } as MessageBlock,
      { kind: "text", text: "second" } as MessageBlock,
    ]);
    expect(segments).toEqual(["first", "second"]);
  });

  it("yields no segments past the server's source bound", () => {
    const segments = quotableMessageSegments("bot", [
      { kind: "text", text: "x".repeat(90_000) } as MessageBlock,
      { kind: "text", text: "y".repeat(90_000) } as MessageBlock,
    ]);
    expect(segments).toEqual([]);
  });

  it("memoizes segments so row chrome does not reparse markdown", () => {
    const blocks = [{ kind: "text", text: "**bold** words" } as MessageBlock];
    expect(quotableMessageSegments("bot", blocks)).toBe(quotableMessageSegments("bot", blocks));
    expect(quotableMessageSegments("user", blocks)).not.toBe(
      quotableMessageSegments("bot", blocks),
    );
  });
});

describe("messageHasInlineControls", () => {
  it("leaves a plain message to the row gestures", () => {
    expect(messageHasInlineControls([{ kind: "text", text: "hello" } as MessageBlock])).toBe(false);
  });

  it("keeps the taps of cards that render their own controls", () => {
    expect(
      messageHasInlineControls([
        { kind: "ask", question: "Which one?", actions: [] } as unknown as MessageBlock,
      ]),
    ).toBe(true);
    expect(
      messageHasInlineControls([
        { kind: "mcp_approval", serverId: "s" } as unknown as MessageBlock,
      ]),
    ).toBe(true);
    expect(
      messageHasInlineControls([
        { kind: "app_connect", provider: "github" } as unknown as MessageBlock,
      ]),
    ).toBe(true);
  });
});
