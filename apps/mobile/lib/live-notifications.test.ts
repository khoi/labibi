import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-modules-core", () => ({ requireNativeModule: vi.fn() }));
vi.mock("expo-notifications", () => ({
  setNotificationHandler: vi.fn(),
  getPresentedNotificationsAsync: vi.fn(async () => []),
  dismissNotificationAsync: vi.fn(async () => undefined),
  dismissAllNotificationsAsync: vi.fn(async () => undefined),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-secure-store", () => ({}));

import * as Notifications from "expo-notifications";
import { configureForegroundNotifications, stopLiveNotifications } from "./live-notifications";

beforeEach(() => vi.clearAllMocks());

// The handler is installed once per module; keep it across cleared mocks.
let foreground: Parameters<typeof Notifications.setNotificationHandler>[0] | undefined;
function _foregroundHandler() {
  configureForegroundNotifications();
  foreground ??= vi.mocked(Notifications.setNotificationHandler).mock.calls[0]?.[0];
  return foreground;
}

describe("when the session ends", () => {
  it("clears the previous account's delivered notifications", async () => {
    await stopLiveNotifications();
    expect(Notifications.dismissAllNotificationsAsync).not.toHaveBeenCalled();

    await stopLiveNotifications(true);
    expect(Notifications.dismissAllNotificationsAsync).toHaveBeenCalledOnce();
  });
});
