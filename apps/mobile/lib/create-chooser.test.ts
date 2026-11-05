import { describe, expect, it, vi } from "vitest";
import { createMenuActions, isCreateAction } from "./create-chooser";

vi.mock("./material-icons", () => ({
  materialIcons: { person_add: 101, group: 102, grid_view: 103 },
}));

const t = (text: string) => `translated: ${text}`;

describe("create menu", () => {
  it("uses SF Symbols on iOS", () => {
    expect(createMenuActions(t, "ios")).toEqual([
      { id: "group", title: "translated: New group chat", image: "person.2" },
      { id: "space", title: "translated: New private space", image: "square.grid.2x2" },
    ]);
  });

  it("uses Material icon assets on Android in the same order", () => {
    expect(createMenuActions(t, "android").map(({ id, image }) => [id, image])).toEqual([
      ["group", 102],
      ["space", 103],
    ]);
  });

  it.each(["group", "space"])("accepts %s", (id) => {
    expect(isCreateAction(id)).toBe(true);
  });

  it.each(["", "other", "bot", "person_add", "constructor"])("rejects %s", (id) => {
    expect(isCreateAction(id)).toBe(false);
  });
});
