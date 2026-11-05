import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActiveBotGlyph } from "./ActiveBotGlyph";

describe("active bot glyph", () => {
  it("animates the active bot glyph from its run status", () => {
    const html = renderToString(
      <ActiveBotGlyph
        bots={[{ botId: "research", color: "#14B8A6", status: "running" }]}
        label="Searching the web: injury news"
      />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('data-state="working"');
  });
});
