import { beforeEach, describe, expect, it, vi } from "vitest";

const { native } = vi.hoisted(() => ({
  native: {
    setOpenThread: vi.fn(async (): Promise<void> => undefined),
    resume: vi.fn(async (): Promise<void> => undefined),
    resumeAfterMute: vi.fn(async (): Promise<void> => undefined),
    stop: vi.fn(async (): Promise<void> => undefined),
  },
}));

vi.mock("expo-modules-core", () => ({ requireNativeModule: () => native }));
vi.mock("expo-notifications", () => ({
  setNotificationHandler: vi.fn(),
  dismissAllNotificationsAsync: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("./i18n", () => ({ getActiveUiLocale: () => "de", t: (text: string) => text }));
const store = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => store.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void store.set(key, value),
  deleteItemAsync: async (key: string) => void store.delete(key),
}));

import * as Notifications from "expo-notifications";
import { resumeLiveNotifications, stopLiveNotifications } from "./live-notifications";
import { saveServerHeaders } from "./server-headers";

describe("Android live notification resume", () => {
  beforeEach(() => {
    native.resume.mockReset();
    native.resumeAfterMute.mockClear();
  });

  it("resumes the native poller with the normalized server and the active UI locale", async () => {
    await resumeLiveNotifications(" app.example.test/api/ ", "token-1", "space-1");
    expect(native.resume).toHaveBeenCalledWith(
      "https://app.example.test",
      "token-1",
      "space-1",
      "de",
      "",
    );
  });

  it("hands the server's custom headers to the native poller", async () => {
    await saveServerHeaders("https://app.example.test", { "CF-Access-Client-Id": "id" });
    await resumeLiveNotifications("https://app.example.test", "token-1", "space-1");
    await saveServerHeaders("https://app.example.test", {});
    expect(native.resume).toHaveBeenCalledWith(
      "https://app.example.test",
      "token-1",
      "space-1",
      "de",
      JSON.stringify({ "CF-Access-Client-Id": "id" }),
    );
  });

  it("does not resume for a public http server, an invalid URL, or no token", async () => {
    await resumeLiveNotifications("http://app.example.test", "token-1", "space-1");
    await resumeLiveNotifications("not a url", "token-1", "space-1");
    await resumeLiveNotifications("https://app.example.test", "", "space-1");
    expect(native.resume).not.toHaveBeenCalled();
  });
});

describe("Android sign-out", () => {
  it("leaves clearing delivered notifications to the native service", async () => {
    await stopLiveNotifications(true);
    expect(native.stop).toHaveBeenCalledWith(true);
    expect(Notifications.dismissAllNotificationsAsync).not.toHaveBeenCalled();
  });
});
