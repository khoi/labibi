import type { ThreadMessage } from "@labradoodle/contracts";
import { describe, expect, it } from "vitest";
import { copyableMessageText } from "./message-text.js";

function message(blocks: ThreadMessage["blocks"]): ThreadMessage {
  return { id: "m_1", threadId: "t_1", seq: 1, role: "bot", blocks, createdAt: "2026-08-29" };
}

describe("copyableMessageText", () => {
  it("joins text, progress, and ask blocks without chrome", () => {
    expect(
      copyableMessageText(
        message([
          { kind: "text", text: "first" },
          { kind: "progress", text: "working" },
          { kind: "ask", text: "question?" },
        ]),
      ),
    ).toBe("first\nworking\nquestion?");
  });

  it("leaves out a block kind it does not know, as an older client does with a newer server's page", () => {
    // Clients read blocks without validating them, so a newer kind reaches this code as is.
    const page = { kind: "page", pageId: "page-1", version: 1, title: "Plan" };
    const blocks = [{ kind: "text", text: "Here it is" }, page] as ThreadMessage["blocks"];
    expect(copyableMessageText(message(blocks))).toBe("Here it is");
  });
});
