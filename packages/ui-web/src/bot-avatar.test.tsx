import { DOOD_PATHS, DOOD_SHAPES } from "@labradoodle/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BOT_AVATAR_COLORS,
  BotAvatar,
  BotShapePreview,
  DEFAULT_BOT_AVATAR_COLOR,
  defaultBotAvatarValue,
  parseBotAvatar,
  resolvePersonaColorDef,
} from "./bot-avatar.js";

function attribute(html: string, name: string): string | undefined {
  return html.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

describe("BotAvatar", () => {
  it("draws a plain-colour bot as a dood in its ink", () => {
    const html = renderToString(<BotAvatar color="#FFBC0A" identity="maya" />);
    expect(html).toContain('data-slot="dood"');
    expect(attribute(html, "data-color")).toBe("yellow");
  });

  it("keeps one stable body per bot and varies it across bots", () => {
    const shapes = new Set(
      Array.from({ length: 24 }, (_, i) =>
        attribute(renderToString(<BotAvatar color="#FFBC0A" identity={`bot-${i}`} />), "data-shape"),
      ),
    );
    expect(shapes.size).toBeGreaterThan(3);
    const once = renderToString(<BotAvatar color="#FFBC0A" identity="maya" />);
    expect(renderToString(<BotAvatar color="#FFBC0A" identity="maya" />)).toBe(once);
  });

  it("draws the studio shape a bot saved", () => {
    const html = renderToString(<BotAvatar color="#1E98F5::shape_3" identity="maya" />);
    expect(attribute(html, "data-shape")).toBe(DOOD_SHAPES[3]);
    expect(html).toContain(DOOD_PATHS[DOOD_SHAPES[3]]);
  });

  it("acts out a bot's activity", () => {
    const pose = (activity: "reading" | "writing" | "thinking" | "idle") => {
      const html = renderToString(<BotAvatar color="#FFBC0A" identity="maya" activity={activity} />);
      return [attribute(html, "data-state"), attribute(html, "data-form")];
    };
    expect(pose("idle")).toEqual(["idle", "self"]);
    expect(pose("thinking")).toEqual(["thinking", "bulb"]);
    expect(pose("reading")).toEqual(["working", "search"]);
    expect(pose("writing")).toEqual(["working", "pen"]);
  });

  it("works while a run is active without a live activity", () => {
    const html = renderToString(<BotAvatar color="#FFBC0A" identity="maya" status="running" />);
    expect(attribute(html, "data-state")).toBe("working");
  });

  it("wears the nearest dood ink for colours saved before the dood palette", () => {
    expect(resolvePersonaColorDef("bot", "#10B981").id).toBe("green");
    expect(resolvePersonaColorDef("bot", "#8B5CF6").id).toBe("lightPink");
    expect(resolvePersonaColorDef("bot", "#fff").id).toBe("grey");
    expect(resolvePersonaColorDef("bot", "#123456").hex).toMatch(/^#/);
    expect(BOT_AVATAR_COLORS).toHaveLength(7);
  });

  it("falls back to the identity palette for invalid custom hex", () => {
    expect(resolvePersonaColorDef("bot", "#zzzzzz")).toEqual(resolvePersonaColorDef("bot"));
  });

  it("parses shape indexes from encoded color values", () => {
    const parsed = parseBotAvatar(`${DEFAULT_BOT_AVATAR_COLOR}::shape_3`);
    expect(parsed).toMatchObject({ color: DEFAULT_BOT_AVATAR_COLOR, shapeIndex: 3, isImage: false });
    expect(parseBotAvatar(`${DEFAULT_BOT_AVATAR_COLOR}::shape_-1`).shapeIndex).toBe(0);
    expect(parseBotAvatar(`${DEFAULT_BOT_AVATAR_COLOR}::shape_3junk`).shapeIndex).toBe(0);
  });

  it("restores the plain colour, whose body the bot's id picks", () => {
    expect(defaultBotAvatarValue(`${DEFAULT_BOT_AVATAR_COLOR}::shape_3`)).toBe(
      DEFAULT_BOT_AVATAR_COLOR,
    );
    expect(defaultBotAvatarValue("data:image/png;base64,abc")).toBe(DEFAULT_BOT_AVATAR_COLOR);
    expect(defaultBotAvatarValue("")).toBe(DEFAULT_BOT_AVATAR_COLOR);
  });

  it("renders uploaded images without a dood", () => {
    const html = renderToString(<BotAvatar color="data:image/png;base64,abc" identity="maya" />);
    expect(html).toContain("<img");
    expect(html).not.toContain('data-slot="dood"');
  });

  it("rings a working photo with the status token", () => {
    const html = renderToString(
      <BotAvatar color="data:image/png;base64,abc" identity="maya" status="running" />,
    );
    expect(html).toContain("labradoodle-bot-avatar-ring-working");
    expect(html).toContain("stroke-status-working");
    expect(
      renderToString(<BotAvatar color="data:image/png;base64,abc" identity="maya" status="idle" />),
    ).not.toContain("labradoodle-bot-avatar-ring");
  });

  it("does not treat arbitrary http(s) color values as remote images", () => {
    const html = renderToString(
      <BotAvatar color="https://evil.example/track.png" identity="maya" size={32} />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil.example");
  });

  it("exposes shape picker name and pressed state", () => {
    const html = renderToString(
      <BotShapePreview shapeIndex={0} color="#FFBC0A" selected onClick={() => undefined} />,
    );
    expect(html).toContain(`aria-label="${DOOD_SHAPES[0]}"`);
    expect(html).toContain('aria-pressed="true"');
  });
});
