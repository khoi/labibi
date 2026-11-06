// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const accountToken = vi.hoisted(() => vi.fn());

// The dialog itself is tested on its own; here it is a button that confirms it.
vi.mock("./ConfirmIdentityDialog", async () => {
  const { useState } = await import("react");
  const { runWithIdentityConfirmation } = await import("@labradoodle/contracts");
  return {
    useIdentityConfirmation: () => {
      const [settle, setSettle] = useState<((confirmed: boolean) => void) | null>(null);
      return {
        withIdentityConfirmation: <T,>(action: () => Promise<T>) =>
          runWithIdentityConfirmation(
            action,
            () => new Promise<boolean>((resolve) => setSettle(() => resolve)),
          ),
        identityDialog: settle ? (
          <button
            type="button"
            data-testid="identity-confirm"
            onClick={() => {
              settle(true);
              setSettle(null);
            }}
          />
        ) : null,
      };
    },
  };
});
vi.mock("../lib/rpc", () => ({ rpc: { export: { accountToken } } }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@labradoodle/ui-web", () => ({
  Button: ({ variant: _variant, ...props }: ComponentProps<"button"> & { variant?: string }) => (
    <button type="button" {...props} />
  ),
  Spinner: () => null,
}));

import { AccountDataSettings } from "./AccountDataSettings";

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  accountToken.mockReset();
});

async function render() {
  await act(async () => {
    root.render(<AccountDataSettings />);
  });
}

function button(name: string) {
  const match = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === name,
  );
  if (!match) throw new Error(`No ${name} button`);
  return match;
}

it("confirms identity before minting the export token, then downloads it by link", async () => {
  const clicked: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this);
  });
  accountToken
    .mockRejectedValueOnce(
      Object.assign(new Error("Confirm it's you"), { code: "IDENTITY_CONFIRMATION_REQUIRED" }),
    )
    .mockResolvedValueOnce({ token: "tok/en+1" });
  await render();

  await act(async () => button("Export").click());
  expect(clicked).toHaveLength(0);
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-testid="identity-confirm"]')!.click();
  });

  expect(accountToken).toHaveBeenCalledTimes(2);
  expect(clicked).toHaveLength(1);
  const link = new URL(clicked[0]!.href);
  expect(link.pathname).toBe("/api/account/export");
  expect(link.searchParams.get("token")).toBe("tok/en+1");
  expect(clicked[0]!.hasAttribute("download")).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
});
