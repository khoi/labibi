// @vitest-environment jsdom

import { DOOD_SHAPES } from "@labradoodle/core";
import type { ReactNode } from "react";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
}));

import { AvatarStudioPopover } from "./avatar-studio-popover";

let container: HTMLDivElement;
let root: Root;
const changed = vi.fn<(value: string) => void>();

function Harness({ value: initial }: { value: string }) {
  const [value, setValue] = useState(initial);
  return (
    <AvatarStudioPopover
      value={value}
      identity="sample-bot"
      onChange={(next) => {
        changed(next);
        setValue(next);
      }}
    />
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  changed.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function button(name: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.getAttribute("aria-label") === name || node.textContent === name,
  );
  if (!found) throw new Error(`Missing button ${name}`);
  return found;
}
async function click(name: string) {
  await act(async () => button(name).click());
}
async function render(value: string) {
  await act(async () => root.render(<Harness value={value} />));
}

function shown() {
  return document.querySelector('[data-slot="dood"]')!;
}

describe("Avatar Studio", () => {
  it("opens without saving and offers no icon set choice", async () => {
    await render("#10B981");
    await click("Customize bot avatar");
    expect(changed).not.toHaveBeenCalled();
    expect(() => button("Original")).toThrow();
    expect(shown().getAttribute("data-color")).toBe("green");
  });

  it("picks one of the eight dood bodies and keeps it while changing colour", async () => {
    await render("#10B981");
    await click("Customize bot avatar");
    await click("Shape 3");
    expect(changed).toHaveBeenLastCalledWith("#4FAA52::shape_2");
    expect(shown().getAttribute("data-shape")).toBe(DOOD_SHAPES[2]);
    await click("Color #1E98F5");
    expect(changed).toHaveBeenLastCalledWith("#1E98F5::shape_2");
    await click("Default");
    expect(changed).toHaveBeenLastCalledWith("#1E98F5");
  });

  it("leaves a photo intact until a body is picked", async () => {
    const photo = "data:image/png;base64,abc";
    await render(photo);
    await click("Customize bot avatar");
    expect(changed).not.toHaveBeenCalled();
    expect(document.querySelector(`img[src="${photo}"]`)).not.toBeNull();
    await click("Shape 1");
    expect(document.querySelector(`img[src="${photo}"]`)).toBeNull();
  });
});
