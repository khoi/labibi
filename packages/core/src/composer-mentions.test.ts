import { describe, expect, it } from "vitest";

import {
  appendConnectorIntent,
  buildComposerMentionOptions,
  connectorIntentLine,
  filterComposerMentionTargets,
  mentionChipKey,
  mentionConnectorsFrom,
  routineScheduleSubtitle,
  splitMentionText,
  stripMentionKinds,
  stripMentionToken,
  toThreadMentionPayload,
} from "./composer-mentions.js";

describe("buildComposerMentionOptions", () => {
  it("lists Doodle, people, routines and connectors", () => {
    const options = buildComposerMentionOptions({
      query: "",
      doodle: true,
      people: [{ id: "u1", name: "Ada" }],
      routines: [{ id: "r1", name: "Daily digest", crons: ["0 9 * * 1-5"] }],
      connectors: [
        { id: "c1", name: "Gmail", authStatus: "connected", connectionId: "c1" },
        { id: "catalog:stripe", name: "Stripe", authStatus: "needs_auth" },
      ],
    });
    expect(options.map((option) => option.kind)).toEqual([
      "doodle",
      "person",
      "routine",
      "connector",
    ]);
    expect(options.some((option) => option.name === "Stripe")).toBe(false);
    expect(options.find((option) => option.kind === "routine")?.subtitle).toMatch(/Weekdays/i);
    expect(mentionChipKey(options.find((option) => option.kind === "routine")!)).toBe("routine:r1");
  });

  it("filters by query before applying limit so later kinds stay reachable", () => {
    const people = Array.from({ length: 40 }, (_, index) => ({
      id: `u${index}`,
      name: `Person${index}`,
    }));
    const options = buildComposerMentionOptions({
      query: "gmail",
      people,
      routines: [],
      connectors: [
        { id: "c1", name: "Gmail", authStatus: "connected", connectionId: "c1" },
        { id: "c2", name: "Granola", authStatus: "needs_auth" },
      ],
      limit: 10,
    });
    expect(options.map((option) => option.name)).toEqual(["Gmail"]);
  });

  it("returns the full catalog when limit is omitted", () => {
    const people = Array.from({ length: 80 }, (_, index) => ({
      id: `u${index}`,
      name: `Person${index}`,
    }));
    const options = buildComposerMentionOptions({
      query: "",
      people,
      routines: [],
      connectors: [{ id: "c1", name: "Gmail", authStatus: "connected", connectionId: "c1" }],
    });
    expect(options).toHaveLength(81);
    expect(options.at(-1)?.name).toBe("Gmail");
  });
});

describe("payload", () => {
  it("omits needs-auth catalog connectors from API payload", () => {
    expect(
      toThreadMentionPayload([
        { kind: "doodle", id: "doodle", name: "Doodle" },
        {
          kind: "connector",
          id: "catalog:stripe",
          name: "Stripe",
          authStatus: "needs_auth",
        },
        {
          kind: "connector",
          id: "c1",
          name: "Gmail",
          authStatus: "connected",
          connectionId: "c1",
        },
      ]),
    ).toEqual([{ kind: "doodle" }, { kind: "connector", id: "c1" }]);
  });
});

describe("strip and connector intent", () => {
  it("strips selected mention kinds from prompt text", () => {
    expect(
      stripMentionKinds(
        "@Planning @Ada check this",
        [
          { kind: "routine", name: "Planning" },
          { kind: "person", name: "Ada" },
        ],
        ["routine"],
      ),
    ).toBe("@Ada check this");
  });

  it("strips multi-word mention tokens", () => {
    expect(stripMentionToken("Ask @Draft team please", "Draft team")).toBe("Ask please");
  });

  it("preserves newlines when stripping mention tokens", () => {
    expect(stripMentionToken("@Planning\n\nline two", "Planning")).toBe("line two");
    expect(stripMentionToken("one\n@Planning\ntwo", "Planning")).toBe("one\n\ntwo");
  });

  it("builds connector intent lines", () => {
    expect(connectorIntentLine(["Gmail", "Stripe"])).toBe(
      "Use these connectors if relevant: Gmail, Stripe.",
    );
    expect(appendConnectorIntent("check inbox", ["Gmail"])).toBe(
      "check inbox\n\nUse these connectors if relevant: Gmail.",
    );
    expect(appendConnectorIntent("", ["Gmail"])).toBe("Use these connectors if relevant: Gmail.");
  });

  it("formats routine subtitles", () => {
    expect(routineScheduleSubtitle(["0 9 * * 1-5"])).toMatch(/Weekdays/i);
  });
});

it("searches the readable fallback when a mention name is opaque", () => {
  expect(
    buildComposerMentionOptions({
      query: "routine",
      routines: [{ id: "r1", name: "__TestTok1__", crons: [] }],
      connectors: [],
    }),
  ).toEqual([{ kind: "routine", id: "r1", name: "Routine", subtitle: "" }]);
});

describe("mentionConnectorsFrom", () => {
  it("lists connected apps, then catalog apps not yet covered by a connection", () => {
    const catalogItem = { connected: false, noAuth: false };
    expect(
      mentionConnectorsFrom(
        [
          { id: "c1", displayName: "Gmail", provider: "gmail", status: "connected" },
          { id: "c2", displayName: "Notion", provider: "notion", status: "revoked" },
        ],
        [
          { ...catalogItem, connectorId: "k", slug: "GMAIL", name: "Google Mail" },
          { ...catalogItem, connectorId: "k", slug: "gmail-work", name: "gmail" },
          { ...catalogItem, connectorId: "k", slug: "notion", name: "Notion" },
          { ...catalogItem, connectorId: "k", slug: "slack", name: "Slack", connected: true },
          { ...catalogItem, connectorId: "k", slug: "weather", name: "Weather", noAuth: true },
        ],
      ),
    ).toEqual([
      { id: "c1", name: "Gmail", authStatus: "connected", connectionId: "c1" },
      { id: "catalog:k:notion", name: "Notion", authStatus: "needs_auth" },
    ]);
  });
});

describe("filterComposerMentionTargets", () => {
  const targets = [
    { kind: "person", name: "Research Bot" },
    { kind: "person", name: "Chef" },
    { kind: "person", name: "Robot Arm" },
    { kind: "person", name: "Zoë Rivera" },
  ] as const;
  const names = (query: string) => filterComposerMentionTargets(targets, query).map((t) => t.name);

  it("keeps the given order for an empty query", () => {
    expect(names("  ")).toEqual(targets.map((target) => target.name));
  });

  it("ranks a word that starts a name word above one inside it, ties in given order", () => {
    expect(names("bo")).toEqual(["Research Bot", "Robot Arm"]);
    expect(names("ro")).toEqual(["Robot Arm"]);
  });

  it("requires every word and ignores accents and case", () => {
    expect(names("research bo")).toEqual(["Research Bot"]);
    expect(names("zoe")).toEqual(["Zoë Rivera"]);
    expect(names("chef bot")).toEqual([]);
  });
});

describe("splitMentionText", () => {
  const targets = [{ name: "Ada" }, { name: "Ada Lovelace" }, { name: "everyone" }];

  it("cuts out each known @Name, longest name first, and keeps the rest as plain runs", () => {
    expect(splitMentionText("hi @Ada Lovelace and @ada, @everyone!", targets)).toEqual([
      { text: "hi " },
      { text: "@Ada Lovelace", target: targets[1] },
      { text: " and " },
      { text: "@ada", target: targets[0] },
      { text: ", " },
      { text: "@everyone", target: targets[2] },
      { text: "!" },
    ]);
  });

  it("leaves text without a known name, an email address and a longer word alone", () => {
    expect(splitMentionText("mail ada@example.test or @Adam", targets)).toEqual([
      { text: "mail ada@example.test or @Adam" },
    ]);
  });
});
