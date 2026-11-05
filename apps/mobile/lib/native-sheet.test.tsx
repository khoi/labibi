// @vitest-environment jsdom

import { tokensForAppearance } from "@labradoodle/ui-tokens";
import type { ReactNode } from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SheetModule from "../components/native-sheet";
import type * as ErrorModule from "../components/run-error-sheet-container";

let NativeSheet: typeof SheetModule.NativeSheet;
let useNativeSheet: typeof SheetModule.useNativeSheet;
let RunErrorSheetContainer: typeof ErrorModule.RunErrorSheetContainer;

const mocks = vi.hoisted(() => ({
  missing: "",
  appearance: "dark" as "light" | "dark",
  load: vi.fn(),
  platform: "android",
  sheet: vi.fn(),
  modal: vi.fn(),
  keyboardAvoider: vi.fn(),
  viewPositionInWindow: vi.fn(),
  keyboardEvents: new Map<string, () => void>(),
  views: vi.fn(),
  listeners: new Map<string, (event: { endCoordinates: { height: number } }) => void>(),
  styles: [] as Record<string, unknown>[],
}));
vi.mock("./compose-available", () => ({
  isComposeViewAvailable: (name: string) => {
    mocks.views(name);
    return name !== mocks.missing;
  },
}));
vi.mock("./native", () => ({
  native: {},
  useThemedStyles: (factory: () => unknown) => factory(),
  useMobileTokens: () => tokensForAppearance(mocks.appearance),
}));
vi.mock("./appearance", () => ({ mobileTokens: () => tokensForAppearance(mocks.appearance) }));
async function loadComponents(gate: Promise<void> = Promise.resolve()) {
  vi.resetModules();
  vi.doMock("@expo/ui/community/bottom-sheet", async () => {
    mocks.load();
    await gate;
    return {
      BottomSheet: (props: { children: ReactNode }) => {
        mocks.sheet(props);
        return props.children;
      },
    };
  });
  ({ NativeSheet, useNativeSheet } = await import("../components/native-sheet"));
  ({ RunErrorSheetContainer } = await import("../components/run-error-sheet-container"));
}
vi.mock("./i18n", () => ({ useI18n: () => ({ t: (text: string) => text }) }));
vi.mock("../components/native-symbol", () => ({ NativeSymbol: () => null }));
vi.mock("../components/native-action-button", () => ({
  NativeActionButton: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  }) => createElement("button", { type: "button", onClick: onPress, disabled }, label),
}));
vi.mock("react-native-keyboard-controller", () => ({
  KeyboardAvoidingView: (props: { children: ReactNode }) => {
    mocks.keyboardAvoider(props);
    return createElement("div", null, props.children);
  },
  KeyboardControllerNative: { viewPositionInWindow: mocks.viewPositionInWindow },
  KeyboardEvents: {
    addListener: (name: string, callback: () => void) => {
      mocks.keyboardEvents.set(name, callback);
      return { remove: () => mocks.keyboardEvents.delete(name) };
    },
  },
}));
vi.mock("react-native", () => ({
  findNodeHandle: () => 1,
  StyleSheet: { create: (styles: unknown) => styles },
  Text: ({ children }: { children: ReactNode }) => createElement("span", null, children),
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => createElement("button", { type: "button", onClick: onPress, disabled }, children),
  TextInput: ({ value, onChangeText }: { value: string; onChangeText: (value: string) => void }) =>
    createElement("input", {
      value,
      onChange: (event: { target: { value: string } }) => onChangeText(event.target.value),
    }),
  KeyboardAvoidingView: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  Platform: {
    get OS() {
      return mocks.platform;
    },
  },
  Keyboard: {
    addListener: (
      name: string,
      callback: (event: { endCoordinates: { height: number } }) => void,
    ) => {
      mocks.listeners.set(name, callback);
      return { remove: () => mocks.listeners.delete(name) };
    },
  },
  useWindowDimensions: () => ({ height: 1000, width: 400 }),
  Modal: (props: { children: ReactNode }) => {
    mocks.modal(props);
    return createElement("dialog", null, props.children);
  },
  View: (props: { children: ReactNode; style: Record<string, unknown> }) => {
    mocks.styles.push(props.style);
    return createElement("div", null, props.children);
  },
  ScrollView: (props: { children: ReactNode }) => createElement("div", null, props.children),
}));

const roots: ReturnType<typeof createRoot>[] = [];
async function mount(node: ReactNode) {
  const element = document.createElement("div");
  const root = createRoot(element);
  Object.assign(root, { element });
  roots.push(root);
  await act(async () => root.render(node));
  return Object.assign(root, { element });
}
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.missing = "";
  mocks.platform = "android";
  mocks.styles.length = 0;
  mocks.appearance = "dark";
  await loadComponents();
});
afterEach(() =>
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  }),
);

describe("Android sheet selection", () => {
  it.each(["light", "dark"] as const)(
    "uses the elevated %s surface and a neutral handle",
    async (appearance) => {
      mocks.appearance = appearance;
      const tokens = tokensForAppearance(appearance);
      const { View } = await import("react-native");
      await mount(
        <RunErrorSheetContainer expanded={false} onClose={vi.fn()}>
          <View style={{ paddingTop: 60, paddingBottom: 24, backgroundColor: tokens.background }} />
        </RunErrorSheetContainer>,
      );
      expect(mocks.sheet.mock.lastCall?.[0]).toMatchObject({
        backgroundStyle: { backgroundColor: tokens.card },
        handleComponent: null,
      });
      expect(mocks.styles).toContainEqual(
        expect.objectContaining({ backgroundColor: tokens.mutedForeground, opacity: 0.4 }),
      );
      expect(tokens.card).not.toBe(tokens.background);
    },
  );
  it("removes only the native top inset and preserves bottom clearance", async () => {
    const { View } = await import("react-native");
    await mount(
      <RunErrorSheetContainer expanded={false} onClose={vi.fn()}>
        <View style={{ flex: 1, paddingTop: 60, paddingBottom: 24 }} />
      </RunErrorSheetContainer>,
    );
    const style = mocks.styles.find(Array.isArray);
    expect(Object.assign({}, ...[style].flat())).toMatchObject({
      flex: undefined,
      paddingTop: 0,
      paddingBottom: 24,
      backgroundColor: tokensForAppearance("dark").card,
    });
  });
  it("preserves full-screen content padding on the fallback path", async () => {
    mocks.missing = "HostView";
    await loadComponents();
    const { View } = await import("react-native");
    await mount(
      <RunErrorSheetContainer expanded={false} onClose={vi.fn()}>
        <View style={{ flex: 1, paddingTop: 60, paddingBottom: 24 }} />
      </RunErrorSheetContainer>,
    );
    expect(mocks.styles).toContainEqual({ flex: 1, paddingTop: 60, paddingBottom: 24 });
  });
  it("preloads before opening and renders no fallback while loading", async () => {
    let resolve!: () => void;
    mocks.load.mockClear();
    await loadComponents(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    expect(mocks.load).toHaveBeenCalledOnce();
    const root = await mount(
      <RunErrorSheetContainer expanded={false} onClose={vi.fn()}>
        Error
      </RunErrorSheetContainer>,
    );
    expect(root.element.textContent).toBe("");
    expect(mocks.modal).not.toHaveBeenCalled();
    await act(async () => resolve());
    expect(root.element.textContent).toBe("Error");
    expect(mocks.modal).not.toHaveBeenCalled();
  });
  it("falls back after an import failure and keeps dismissal working", async () => {
    let reject!: (error: Error) => void;
    await loadComponents(
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
    );
    const close = vi.fn();
    await mount(
      <RunErrorSheetContainer expanded={false} onClose={close}>
        Error
      </RunErrorSheetContainer>,
    );
    expect(mocks.modal).not.toHaveBeenCalled();
    await act(async () => reject(new Error("Unavailable")));
    expect(mocks.modal.mock.lastCall?.[0]).toMatchObject({ visible: true, onRequestClose: close });
    act(() => mocks.modal.mock.lastCall?.[0].onRequestClose());
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(["HostView", "ModalBottomSheetView", "RNHostView", "SlotView"])(
    "keeps the original run error Modal when %s is missing",
    async (missing) => {
      mocks.missing = missing;
      mocks.load.mockClear();
      await loadComponents();
      const close = vi.fn();
      await mount(
        <RunErrorSheetContainer expanded onClose={close}>
          Error
        </RunErrorSheetContainer>,
      );
      expect(mocks.load).not.toHaveBeenCalled();
      expect(mocks.sheet).not.toHaveBeenCalled();
      expect(mocks.modal.mock.lastCall?.[0]).toMatchObject({
        visible: true,
        animationType: "slide",
        onRequestClose: close,
      });
    },
  );
  it("uses the community sheet only after checking every native adapter", async () => {
    await mount(
      <RunErrorSheetContainer expanded={false} onClose={vi.fn()}>
        Error
      </RunErrorSheetContainer>,
    );
    expect(mocks.views.mock.calls.flat()).toEqual([
      "HostView",
      "ModalBottomSheetView",
      "RNHostView",
      "SlotView",
    ]);
    expect(mocks.sheet.mock.lastCall?.[0]).toMatchObject({
      enableDynamicSizing: true,
      enablePanDownToClose: true,
      backgroundStyle: { backgroundColor: tokensForAppearance("dark").card },
    });
  });
  it("does not load a Compose sheet on iOS", async () => {
    mocks.platform = "ios";
    mocks.views.mockClear();
    await loadComponents();
    function Probe() {
      return useNativeSheet() ? "native" : "fallback";
    }
    await mount(<Probe />);
    expect(mocks.views).not.toHaveBeenCalled();
    expect(mocks.sheet).not.toHaveBeenCalled();
  });
});

describe("native sheet behavior", () => {
  const Sheet = (props: { children?: ReactNode }) => {
    mocks.sheet(props);
    return props.children;
  };
  it("enables native dismissal and ignores duplicate close notifications", async () => {
    const close = vi.fn();
    await mount(
      <NativeSheet Sheet={Sheet} onClose={close}>
        Actions
      </NativeSheet>,
    );
    const props = mocks.sheet.mock.lastCall?.[0];
    // Swipe, scrim tap and Back all reach onClose through the community adapter, which can
    // report the same dismissal twice; gestures themselves are checked on a device.
    expect(props.enablePanDownToClose).toBe(true);
    act(() => {
      props.onClose();
      props.onClose();
    });
    expect(close).toHaveBeenCalledOnce();
  });
  it("switches from content sizing to a tall expanded run error sheet", async () => {
    const root = await mount(
      <RunErrorSheetContainer expanded={false} onClose={vi.fn()}>
        Error
      </RunErrorSheetContainer>,
    );
    expect(mocks.styles).toContainEqual({ maxHeight: 852, height: undefined });
    await act(async () =>
      root.render(
        <RunErrorSheetContainer expanded onClose={vi.fn()}>
          Error
        </RunErrorSheetContainer>,
      ),
    );
    expect(mocks.styles).toContainEqual({ maxHeight: 852, height: 852 });
  });
  it("reduces the scroll viewport above the keyboard and restores it on hide", async () => {
    await mount(
      <NativeSheet Sheet={Sheet} onClose={vi.fn()} label="Chat">
        Actions
      </NativeSheet>,
    );
    act(() => mocks.listeners.get("keyboardDidShow")?.({ endCoordinates: { height: 300 } }));
    expect(mocks.styles).toContainEqual({ maxHeight: 552, height: undefined });
    act(() => mocks.listeners.get("keyboardDidHide")?.({ endCoordinates: { height: 0 } }));
    expect(mocks.styles.at(-1)).toEqual({ maxHeight: 852, height: undefined });
  });
});
