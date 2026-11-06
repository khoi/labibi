// @vitest-environment jsdom

import { act, createElement, useEffect } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appState: "active",
  listener: null as ((state: string) => void) | null,
  setOpen: vi.fn(async (_thread: unknown) => undefined),
  focused: true,
}));

vi.mock("expo-router", () => ({
  // Runs while the screen is mounted, re-running only when the callback identity changes.
  useFocusEffect: (effect: () => undefined | (() => void)) => useEffect(effect, [effect]),
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return state.appState;
    },
    addEventListener: (_: string, listener: (state: string) => void) => {
      state.listener = listener;
      return {
        remove: () => {
          state.listener = null;
        },
      };
    },
  },
}));
vi.mock("./live-notifications", () => ({ setOpenNotificationThread: state.setOpen }));

import { useOpenNotificationThread } from "./use-open-notification-thread";

type Props = { botId?: string; threadId?: string; markReadIfVisible: () => void };

const navigation = { isFocused: () => state.focused };
let root: Root;

function Probe(props: Props) {
  useOpenNotificationThread({ ...props, navigation });
  return null;
}

const render = (props: Props) => act(() => root.render(createElement(Probe, props)));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.appState = "active";
  state.focused = true;
  state.setOpen.mockClear();
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it("does not reopen or read on return when the thread is not focused or not known", () => {
  const markRead = vi.fn();
  render({ botId: "bot-1", threadId: "thread-1", markReadIfVisible: markRead });
  state.setOpen.mockClear();
  state.focused = false;
  act(() => state.listener?.("active"));
  expect(state.setOpen).not.toHaveBeenCalled();

  state.focused = true;
  render({ botId: "bot-1", markReadIfVisible: markRead });
  state.setOpen.mockClear();
  act(() => state.listener?.("active"));
  expect(state.setOpen).not.toHaveBeenCalled();
  expect(markRead).not.toHaveBeenCalled();
});

it("does not open a thread while the app is in the background", () => {
  state.appState = "background";
  render({ botId: "bot-1", threadId: "thread-1", markReadIfVisible: vi.fn() });
  expect(state.setOpen).not.toHaveBeenCalled();
});
