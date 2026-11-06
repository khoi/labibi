import { afterEach, describe, expect, it } from "vitest";
import { askActionLabel } from "./ask-action-label";
import { resetI18nForTests, t } from "./i18n";

const fakeT = (message: string, values?: Record<string, string | number>) =>
  message.replace(/\{site\}/g, () => String(values?.site));

describe("askActionLabel", () => {
  afterEach(() => resetI18nForTests());

  it.each([
    ["always", "example.test", "Always allow example.test"],
    ["always", undefined, "Always allow this tool"],
    ["always", "", "Always allow this tool"],
    ["allow", undefined, "Allow once"],
    ["deny", undefined, "Deny"],
    ["custom", undefined, "Server label"],
  ])("labels approval action %s with site %s", (id, site, expected) => {
    expect(askActionLabel({ id, label: "Server label" }, { approval: true, site }, fakeT)).toBe(
      expected,
    );
  });

  it("labels the user's-computer allow as covering the workspace", () => {
    expect(
      askActionLabel({ id: "allow", label: "Allow in this workspace" }, { approval: true }, fakeT),
    ).toBe("Allow in this workspace");
  });

  it.each(["allow", "always", "deny", "custom"])(
    "preserves the server label for non-approval action %s",
    (id) => {
      expect(
        askActionLabel(
          { id, label: "Server label" },
          { approval: false, site: "example.test" },
          fakeT,
        ),
      ).toBe("Server label");
    },
  );

  it("uses the real mobile translator with site interpolation", () => {
    resetI18nForTests("de");
    expect(
      askActionLabel(
        { id: "always", label: "Server label" },
        { approval: true, site: "example.test" },
        t,
      ),
    ).toBe("example.test immer erlauben");
  });
});
