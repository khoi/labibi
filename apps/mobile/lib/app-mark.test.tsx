// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => {
  function MockView(props: {
    children?: ReactNode;
    accessible?: boolean;
    accessibilityElementsHidden?: boolean;
    importantForAccessibility?: string;
  }) {
    return createElement(
      "div",
      {
        "data-accessible": String(props.accessible),
        "aria-hidden": props.accessibilityElementsHidden ? "true" : undefined,
        "data-important": props.importantForAccessibility,
      },
      props.children,
    );
  }

  return { View: MockView };
});

vi.mock("react-native-svg", () => {
  const element =
    (tag: string) =>
    ({ children, fill, stroke }: { children?: ReactNode; fill?: string; stroke?: string }) =>
      createElement(tag, { "data-fill": fill, "data-stroke": stroke }, children);
  return { default: element("svg"), G: element("g"), Path: element("path") };
});

vi.mock("./native", () => ({ useMobileTokens: () => ({ foreground: "#141414" }) }));

import { AppMark } from "../components/app-mark";

describe("AppMark", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
  });

  it("draws Doodle, hidden from VoiceOver and TalkBack, with eyes in the text colour", () => {
    act(() => {
      root?.render(<AppMark />);
    });
    const mark = container?.querySelector("div");

    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.dataset.accessible).toBe("false");
    expect(mark?.dataset.important).toBe("no-hide-descendants");
    expect(container?.querySelector("path")?.dataset.stroke).toBe("#FFBC0A");
    expect(container?.querySelector("g")?.dataset.fill).toBe("#141414");
  });
});
