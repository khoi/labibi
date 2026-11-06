import { describe, expect, it, vi } from "vitest";
import { matchesArtifactQuery } from "./artifacts";

vi.mock("expo-file-system", () => ({ File: class {}, Paths: {} }));
vi.mock("./api", () => ({ rpc: vi.fn() }));

describe("matchesArtifactQuery", () => {
  const item = { name: "Landing page draft.html", description: "Hero + pricing section" };

  it("matches an empty query", () => {
    expect(matchesArtifactQuery(item, "")).toBe(true);
    expect(matchesArtifactQuery(item, "   ")).toBe(true);
  });

  it("matches case-insensitively against the name or description", () => {
    expect(matchesArtifactQuery(item, "LANDING")).toBe(true);
    expect(matchesArtifactQuery(item, "pricing")).toBe(true);
    expect(matchesArtifactQuery(item, "nope")).toBe(false);
  });

  it("handles a null description", () => {
    expect(matchesArtifactQuery({ name: "Notes.md", description: null }, "notes")).toBe(true);
    expect(matchesArtifactQuery({ name: "Notes.md", description: null }, "hero")).toBe(false);
  });
});
