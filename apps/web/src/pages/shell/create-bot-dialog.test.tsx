// @vitest-environment jsdom

import { DOOD_SHAPES } from "@labradoodle/core";
import type { ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateBotDialogInput } from "./create-bot-dialog";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => `${text}${index > 0 ? values[index - 1] : ""}${part}`, "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});

import { CreateBotDialog } from "./create-bot-dialog";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(onCreate: (input: CreateBotDialogInput) => Promise<void>) {
  await act(async () => {
    root.render(<CreateBotDialog onCancel={() => undefined} onCreate={onCreate} />);
  });
}

function preview() {
  return document.querySelector('[data-testid="create-bot-dialog"] [data-slot="dood"]')!;
}

function button(name: string) {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.getAttribute("aria-label") === name || element.textContent === name,
  );
  if (!found) throw new Error(`No button ${name}`);
  return found;
}

async function typeName(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[placeholder="Name your Bot"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

describe("CreateBotDialog", () => {
  it("creates only once the name is not blank", async () => {
    const onCreate = vi.fn(async () => undefined);
    await render(onCreate);
    expect(button("Create").disabled).toBe(true);
    await typeName("   ");
    expect(button("Create").disabled).toBe(true);
    await typeName("  Scout  ");
    expect(button("Create").disabled).toBe(false);
  });

  it("reserves the preview id, so the bot keeps the dood it showed", async () => {
    const onCreate = vi.fn(async (_input: CreateBotDialogInput) => undefined);
    await render(onCreate);
    expect(document.querySelector('[role="tablist"]')).toBeNull();
    await typeName("Scout");
    await click(button("Create"));
    const input = onCreate.mock.lastCall![0];
    expect(input).toMatchObject({ name: "Scout" });
    expect(input).not.toHaveProperty("avatarFamily");
    expect(input.id).toMatch(/^c[a-z0-9]{24}$/);
  });

  it("sends the shape and colour picked in the dialog", async () => {
    const onCreate = vi.fn(async (_input: CreateBotDialogInput) => undefined);
    await render(onCreate);
    await click(button("Color #4FAA52"));
    await click(button("Shape 2"));
    expect(preview().getAttribute("data-shape")).toBe(DOOD_SHAPES[1]);
    expect(preview().getAttribute("data-color")).toBe("green");
    await typeName("Scout");
    await click(button("Create"));
    expect(onCreate.mock.lastCall?.[0]).toMatchObject({
      name: "Scout",
      color: "#4FAA52::shape_1",
    });
  });

  it("shows the error and stays open when creating fails", async () => {
    await render(async () => {
      throw new Error("Bot limit reached");
    });
    await typeName("Scout");
    await click(button("Create"));
    expect(document.querySelector('[data-testid="create-bot-error"]')?.textContent).toBe(
      "Bot limit reached",
    );
    expect(document.querySelector('[data-testid="create-bot-dialog"]')).not.toBeNull();
  });
});

it("retains the preview identity and colour through rerenders and a retry", async () => {
  const onCreate = vi
    .fn(async (_input: CreateBotDialogInput) => undefined)
    .mockRejectedValueOnce(new Error("Try again"));
  await render(onCreate);
  const look = preview().outerHTML;
  await typeName("First name");
  await render(onCreate);
  expect(preview().outerHTML).toBe(look);
  await click(button("Create"));
  const first = onCreate.mock.lastCall![0];
  await typeName("Retry name");
  await click(button("Create"));
  const second = onCreate.mock.lastCall![0];
  expect(first.id).toMatch(/^c[a-z0-9]{24}$/);
  expect(second.id).toBe(first.id);
  expect(second.color).toBe(first.color);
});
