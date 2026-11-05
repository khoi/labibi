// @vitest-environment jsdom

import type { CSSProperties, ReactElement, ReactNode } from "react";
import { act, cloneElement, useEffect, useMemo, useState } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useInboxRenderItem } from "../components/inbox-render-item";
import { BotRow } from "../components/inbox-rows";
import type { MobileBot } from "./api";
import { formatThreadTime } from "./inbox";
import { retainInboxValue } from "./inbox-retention";
import type { InboxItem, InboxSpace } from "./inbox-spaces";
import { inboxItemKey } from "./inbox-spaces";
import { useInboxDay } from "./use-inbox-day";
import { usePublishSearchInbox } from "./use-publish-search-inbox";

type MenuProps = {
  actions: { id: string; title: string }[];
  onPressAction: (event: { nativeEvent: { event: string } }) => void;
  children?: ReactNode;
};
const ui = vi.hoisted(() => ({
  focused: true,
  appStateListener: undefined as ((state: string) => void) | undefined,
  previews: 0,
  push: vi.fn(),
  menus: [] as MenuProps[],
  swipeRows: [] as string[],
  avatars: [] as string[],
  chevronStarts: [] as number[],
  chevronTargets: [] as number[],
  rpc: vi.fn(),
  alert: vi.fn(),
  spaceId: "space-a",
  spaceSeq: 0,
  sameSession: true,
  setSearchInbox: vi.fn(),
  addToSearchInbox: vi.fn(),
  searchInboxSession: vi.fn(),
  loadCollapsedSections: vi.fn(),
  saveCollapsedSections: vi.fn(),
}));

vi.mock("react-native", () => {
  const flatten = (style: unknown): CSSProperties =>
    Object.assign({}, ...[style].flat(Number.POSITIVE_INFINITY).filter(Boolean));
  return {
    Alert: { alert: ui.alert },
    AppState: {
      addEventListener: (_event: string, listener: (state: string) => void) => {
        ui.appStateListener = listener;
        return { remove: () => (ui.appStateListener = undefined) };
      },
    },
    Platform: { OS: "ios" },
    PlatformColor: (name: string) => name,
    StyleSheet: { create: <T,>(styles: T) => styles },
    useWindowDimensions: () => ({ width: 400, height: 800, fontScale: 1 }),
    View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    Pressable: ({
      children,
      accessibilityLabel,
      accessibilityState,
      accessibilityValue,
      onPress,
      style,
    }: {
      children?: ReactNode;
      accessibilityLabel?: string;
      accessibilityState?: { expanded?: boolean };
      accessibilityValue?: { text?: string };
      onPress?: () => void;
      style?: unknown;
    }) => (
      <button
        type="button"
        aria-label={accessibilityLabel}
        aria-expanded={accessibilityState?.expanded}
        data-value={accessibilityValue?.text}
        data-min-height={
          flatten(typeof style === "function" ? style({ pressed: false }) : style).minHeight
        }
        onClick={onPress}
      >
        {children}
      </button>
    ),
  };
});
vi.mock("react-native-reanimated", () => ({
  default: { View: ({ children }: { children?: ReactNode }) => <div>{children}</div> },
  Easing: { out: (easing: unknown) => easing, cubic: "cubic" },
  ReduceMotion: { System: "system" },
  useAnimatedStyle: (style: () => unknown) => style(),
  useSharedValue: (value: number) => {
    const [shared] = useState(() => {
      ui.chevronStarts.push(value);
      return { value };
    });
    return shared;
  },
  withTiming: (value: number) => {
    ui.chevronTargets.push(value);
    return value;
  },
}));
vi.mock("@expo/ui/community/menu", () => ({
  MenuView: (props: MenuProps) => {
    ui.menus.push(props);
    return props.children;
  },
}));
vi.mock("expo-router", () => {
  const router = { push: ui.push };
  return {
    router,
    useRouter: () => router,
    // The inbox's focus: expo-router reruns the effect when focus returns.
    useFocusEffect: (effect: () => (() => void) | undefined) => {
      const focused = ui.focused;
      useEffect(() => (focused ? effect() : undefined), [effect, focused]);
    },
  };
});
vi.mock("./api", () => ({
  rpc: ui.rpc,
  selectedSpaceId: () => ui.spaceId,
  spaceSelectionSeq: () => ui.spaceSeq,
}));
vi.mock("./native", () => ({
  native: {},
  useThemedStyles: (factory: () => unknown) => useMemo(factory, [factory]),
}));
vi.mock("./appearance", () => ({ mobileTokens: () => ({}) }));
vi.mock("./i18n", () => {
  const t = (text: string, values?: Record<string, string>) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => values?.[key] ?? key);
  return { t, useI18n: () => ({ t }), dateLocaleForUi: () => "en-US" };
});
// The row's avatar freezes while the row is scrolled out of view.
vi.mock("./avatar-life", () => ({
  AvatarRow: ({ id, children }: { id: string; children: ReactNode }) => (
    <i data-row={id}>{children}</i>
  ),
}));
// Counts row executions: every bot row render builds its preview once.
vi.mock("./preview", () => ({
  previewSnippet: (text: string) => {
    ui.previews++;
    return text;
  },
}));
vi.mock("./collapsed-sections", () => ({
  loadCollapsedSections: ui.loadCollapsedSections,
  saveCollapsedSections: ui.saveCollapsedSections,
}));
vi.mock("./search-inbox", () => ({
  setSearchInbox: ui.setSearchInbox,
  addToSearchInbox: ui.addToSearchInbox,
  searchInboxSession: ui.searchInboxSession,
  isSearchInboxSession: () => ui.sameSession,
}));
vi.mock("../components/bot-avatar", () => ({
  BotAvatar: ({
    identity,
    muted,
    motion,
  }: {
    identity: string;
    muted?: boolean;
    motion?: string;
  }) => {
    ui.avatars.push(identity);
    return <b data-identity={identity} data-muted={String(Boolean(muted))} data-motion={motion} />;
  },
}));
vi.mock("../components/group-avatar", () => ({ GroupAvatar: () => null }));
// Rows in the current space carry the iOS swipe host and its long-press menu.
vi.mock("../components/inbox-swipe-row", () => ({
  InboxSwipeRow: ({ rowKey, children }: { rowKey: string; children: ReactElement }) => {
    ui.swipeRows.push(rowKey);
    return children;
  },
}));
vi.mock("../components/native-symbol", () => ({ NativeSymbol: () => null }));

const action = vi.fn();
const callbacks = {
  appearance: "light" as const,
  botAction: action,
  chooseInboxSpace: action,
  confirmDeleteSpace: action,
  groupAction: action,
  openBot: action,
  openGroup: action,
  notifyFromMenu: action,
  sharing: false,
  spaceBusy: false,
  spaceRecoveryId: null,
};

let onRenderItem: ((renderItem: unknown) => void) | undefined;
function List({
  items,
  spaceId = "space-1",
  day = 0,
  options,
}: {
  items: InboxItem[];
  spaceId?: string;
  day?: number;
  options?: Partial<Parameters<typeof useInboxRenderItem>[0]>;
}) {
  const renderItem = useInboxRenderItem({ ...callbacks, ...options, day, spaceId });
  onRenderItem?.(renderItem);
  // Keyed like the inbox's FlatList.
  return items.map((item) => cloneElement(renderItem({ item }), { key: inboxItemKey(item) }));
}

function DayList({ items }: { items: InboxItem[] }) {
  return <List items={items} day={useInboxDay()} />;
}

let container: HTMLDivElement;
let root: Root;
const render = (element: ReactNode) => act(() => root.render(element));
const rowLabels = () =>
  Array.from(container.querySelectorAll("button"), (button) => button.getAttribute("aria-label"));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.assign(ui, {
    focused: true,
    previews: 0,
    menus: [],
    swipeRows: [],
    avatars: [],
    chevronStarts: [],
    chevronTargets: [],
  });
  onRenderItem = undefined;
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

function measure(retain: boolean) {
  let previousRenderItem: unknown;
  onRenderItem = (renderItem) => {
    // Parent renders must not hand the list a new renderer, or every row would render.
    if (previousRenderItem) expect(renderItem).toBe(previousRenderItem);
    previousRenderItem = renderItem;
  };
  const items = (bots: MobileBot[]) => bots.map((bot) => ({ type: "bot" as const, bot }));
  let bots = Array.from({ length: 30 }, (_, index) => ({
    id: `bot-${index}`,
    name: `Helper ${index}`,
    spaceId: "space-1",
    preview: "",
    color: "gray",
    status: "idle",
    notifyOnFinish: true,
    unread: false,
  })) as MobileBot[];
  ui.previews = 0;
  render(<List items={items(bots)} />);
  const mount = ui.previews;
  for (let poll = 0; poll < 12; poll++) {
    const fetched = structuredClone(bots);
    bots = retain ? retainInboxValue(bots, fetched) : fetched;
    // Force parent rendering too, as with activity/refresh state changes.
    render(<List items={items(bots)} />);
  }
  const idle = ui.previews - mount;
  const fetched = structuredClone(bots);
  fetched[0]!.status = "running";
  fetched[0]!.unread = true;
  bots = retain ? retainInboxValue(bots, fetched) : fetched;
  render(<List items={items(bots)} />);
  act(() => root.unmount());
  root = createRoot(container);
  return { mount, idle, changed: ui.previews - mount - idle };
}

it("skips unchanged inbox rows for 12 idle polls and renders the changed bot", () => {
  // Without retained poll results every row renders on every poll.
  expect(measure(false)).toEqual({ mount: 30, idle: 360, changed: 30 });
  expect(measure(true)).toEqual({ mount: 30, idle: 0, changed: 1 });
});

it.each(["midnight", "focus", "foreground"])(
  "refreshes unchanged bot and group timestamps on %s",
  (trigger) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 10, 23, 59));
    const today = new Date(2026, 9, 10, 12, 30).toISOString();
    const sixDaysAgo = new Date(2026, 9, 4, 12, 30).toISOString();
    // Keep the response and every row object identical throughout the date change.
    const items = [today, sixDaysAgo].flatMap((updatedAt): InboxItem[] => [
      { type: "bot", bot: { id: updatedAt, name: "Helper", preview: "", updatedAt } as MobileBot },
      {
        type: "group",
        group: { id: updatedAt, name: "Team", preview: "", members: [], updatedAt },
      } as unknown as InboxItem,
    ]);
    const labels = (todayTime: string, weekTime: string) => [
      `Helper, ${todayTime}, No messages yet`,
      `Team, ${todayTime}`,
      `Helper, ${weekTime}, No messages yet`,
      `Team, ${weekTime}`,
    ];
    try {
      render(<DayList items={items} />);
      const weekday = formatThreadTime(sixDaysAgo, new Date(2026, 9, 10));
      expect(rowLabels()).toEqual(labels("12:30", weekday));
      if (trigger === "focus") {
        ui.focused = false;
        render(<DayList items={items} />);
        expect(ui.appStateListener).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
      }
      if (trigger === "midnight") {
        act(() => vi.advanceTimersByTime(60_000));
      } else {
        // Suspended native timers need not fire before the app returns.
        vi.setSystemTime(new Date(2026, 9, 11, 8));
        act(() => {
          if (trigger === "foreground") ui.appStateListener?.("active");
          else {
            ui.focused = true;
            root.render(<DayList items={items} />);
          }
        });
      }
      expect(rowLabels()).toEqual(labels(formatThreadTime(today), formatThreadTime(sixDaysAgo)));
      expect(formatThreadTime(today)).not.toBe("12:30");
      expect(formatThreadTime(sixDaysAgo)).not.toBe(weekday);
      expect(vi.getTimerCount()).toBe(1);
      act(() => root.unmount());
      expect(ui.appStateListener).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
      root = createRoot(container);
    } finally {
      vi.useRealTimers();
    }
  },
);

it("renders saved bot rows without a notification setting", () => {
  // Inboxes saved before notification settings were kept have bots without them.
  const bots = [
    { id: "bot-a", name: "Alpha", preview: "", notifyOnFinish: true },
    { id: "bot-b", name: "Beta", preview: "" },
    { id: "bot-c", name: "Gamma", preview: "", notifyOnFinish: false },
  ] as MobileBot[];
  render(
    bots.map((bot) => (
      <BotRow key={bot.id} bot={bot} day={0} onPress={action} onNotifyChange={action} />
    )),
  );
  expect(rowLabels()).toEqual([
    "Alpha, No messages yet",
    "Beta, No messages yet",
    "Gamma, notifications silenced, No messages yet",
  ]);
  expect(Array.from(container.querySelectorAll("button"), (row) => row.textContent)).toEqual([
    "AlphaNo messages yet",
    "BetaNo messages yet",
    "GammaNo messages yet",
  ]);
  const avatars = Array.from(container.querySelectorAll("i[data-row] > b"));
  expect(avatars.map((avatar) => avatar.parentElement?.dataset.row)).toEqual([
    "bot-a",
    "bot-b",
    "bot-c",
  ]);
  expect(avatars.map((avatar) => (avatar as HTMLElement).dataset.muted)).toEqual([
    "false",
    "false",
    "true",
  ]);
  expect(avatars.every((avatar) => (avatar as HTMLElement).dataset.motion === "lazy")).toBe(true);
});

it("says working only while the bot works, and shows nothing beside the time", () => {
  const bots = ["running", "waiting_takeover", "waiting_input", "idle"].map(
    (status) => ({ id: status, name: "Helper", preview: "Hi", status }) as MobileBot,
  );
  render(
    bots.map((bot) => (
      <BotRow key={bot.id} bot={bot} day={0} onPress={action} onNotifyChange={action} />
    )),
  );
  // A "Needs you" computer card or an ask card is the state; the row must not claim work.
  expect(rowLabels()).toEqual(["Helper, Working…, Hi", "Helper, Hi", "Helper, Hi", "Helper, Hi"]);
  // The avatar's motion and corner dot are the only working sign; the time stands alone.
  expect(Array.from(container.querySelectorAll("button"), (row) => row.textContent)).toEqual([
    "HelperHi",
    "HelperHi",
    "HelperHi",
    "HelperHi",
  ]);
});

it("waits for a saved or live inbox before publishing a remounted session's search roster", () => {
  const publish = ui.setSearchInbox.mockReset();
  function PublishRoster({ me, inboxSpaces }: { me: object | null; inboxSpaces: InboxSpace[] }) {
    usePublishSearchInbox(inboxSpaces, me !== null);
    return null;
  }
  const me = { spaceId: "space-a" };
  const loaded = [
    { id: "space-a", bots: [{ id: "bot-a" }], groups: [] },
  ] as unknown as InboxSpace[];
  render(<PublishRoster key="session-1" me={null} inboxSpaces={[]} />);
  expect(publish).not.toHaveBeenCalled();
  // Either a verified saved inbox or the first live response supplies me and the roster.
  render(<PublishRoster key="session-1" me={me} inboxSpaces={loaded} />);
  expect(publish).toHaveBeenLastCalledWith(loaded);
  publish.mockClear();
  // HomeSession remounts Home for the new generation, even behind an unfocused route.
  render(<PublishRoster key="session-2" me={null} inboxSpaces={[]} />);
  expect(publish).not.toHaveBeenCalled();
  render(<PublishRoster key="session-2" me={me} inboxSpaces={loaded} />);
  expect(publish).toHaveBeenCalledExactlyOnceWith(loaded);
  // A loaded inbox may legitimately become empty; only the initial placeholder is skipped.
  render(<PublishRoster key="session-2" me={me} inboxSpaces={[]} />);
  expect(publish).toHaveBeenLastCalledWith([]);
});

it("gives the long-press menu, and with it Delete, only to chats in the current space", () => {
  const chat = (id: string, spaceId: string) => ({
    id,
    spaceId,
    name: id,
    preview: "",
    members: [],
  });
  // Chats listed from another space have no row menu, as with Archive.
  const items = [
    { type: "bot", bot: chat("current-bot", "space-current") },
    { type: "group", group: chat("current-group", "space-current") },
    { type: "bot", bot: chat("other-bot", "space-other") },
    { type: "group", group: chat("other-group", "space-other") },
  ] as unknown as InboxItem[];
  render(<List items={items} spaceId="space-current" />);
  expect(ui.swipeRows).toEqual(["bot:current-bot", "group:current-group"]);
});

it("offers every space heading's Members and Settings, and Delete only where the member may delete it", () => {
  const confirmDeleteSpace = vi.fn();
  ui.push.mockReset();
  const heading = (id: string, name: string, canDelete: boolean) =>
    ({
      type: "heading",
      key: id,
      title: name,
      space: { id, name, isDefault: !canDelete, canDelete, bots: [], groups: [] },
    }) as unknown as InboxItem;
  render(
    <List
      items={[heading("space-home", "Home", false), heading("space-work", "Work", true)]}
      spaceId="space-home"
      options={{ confirmDeleteSpace }}
    />,
  );
  expect(ui.menus.map((menu) => menu.actions.map((entry) => entry.id))).toEqual([
    ["members", "settings"],
    ["members", "settings", "delete"],
  ]);
  act(() => ui.menus[1]!.onPressAction({ nativeEvent: { event: "members" } }));
  expect(ui.push).toHaveBeenLastCalledWith({
    pathname: "/space-members",
    params: { spaceId: "space-work", name: "Work" },
  });
  // Settings open the Space's own page, which edits that Space even when another is selected.
  act(() => ui.menus[1]!.onPressAction({ nativeEvent: { event: "settings" } }));
  expect(ui.push).toHaveBeenCalledWith({
    pathname: "/space",
    params: { spaceId: "space-work", name: "Work" },
  });
  act(() => ui.menus[1]!.onPressAction({ nativeEvent: { event: "delete" } }));
  expect(confirmDeleteSpace).toHaveBeenCalledWith(expect.objectContaining({ id: "space-work" }));
});
