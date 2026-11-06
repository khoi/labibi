import { expect, test } from "@playwright/test";
import { activeThreadId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("a bot connects an app inline in a normal chat", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signup(page, `inline-connect-${Date.now()}@labradoodle.test`, "password12", "Sample");
  await completeOnboarding(page);
  const botId = activeThreadId(page);
  await rpc(page, "onboarding/dismissFocus", { threadId: botId });
  await page.getByPlaceholder(/Message/).fill("Can you check my Gmail inbox?");
  await page.keyboard.press("Enter");
  const card = page.getByRole("group", { name: "Gmail connection", exact: true });
  await expect(card).toBeVisible();
  await expect(
    page
      .getByTestId("message-bot-bubble")
      .getByText("Connect Gmail and I’ll check your inbox.", { exact: true }),
  ).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    await captureScreenshot(page, testInfo, `web-pending-${theme}`);
  }
  await card.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(card.getByText("Connected", { exact: true })).toBeVisible();
  await page.reload();
  await expect(card.getByText("Connected", { exact: true })).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute("data-theme", value),
      theme,
    );
    await captureScreenshot(page, testInfo, `web-connected-${theme}`);
  }
});
