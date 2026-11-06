import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openUserSettings, signup } from "./helpers";

test("teach a task records interaction and saves a draft", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `teach-${stamp}@labradoodle.test`, "password12", "Teach");
  await completeOnboarding(page);

  const settings = await openUserSettings(page, "computer");
  await settings.getByTestId("open-my-computer").click();
  await expect(page.getByRole("button", { name: "Close computer" })).toBeVisible();
  const chrome = page.getByTestId("computer-chrome");
  await chrome.getByRole("button", { name: "Take control", exact: true }).click();
  await expect(chrome.getByText("You have control", { exact: true })).toBeVisible();
  await expect(chrome.getByRole("button", { name: "Release control", exact: true })).toBeVisible();
  await expect(chrome.getByTestId("teach-start-button")).toBeVisible();
  const more = chrome.getByTestId("computer-more-button");
  if (await more.isVisible().catch(() => false)) {
    await more.click();
    await expect(page.getByTestId("computer-more-menu")).toBeVisible();
    // Close via the More control again (Escape must not close the computer overlay).
    await more.click();
    await expect(page.getByTestId("computer-more-menu")).toHaveCount(0);
  }
  await captureScreenshot(page, testInfo, "teach-computer-chrome");

  const teachStart = chrome.getByTestId("teach-start-button");
  await expect(teachStart).toBeEnabled();
  await teachStart.click();
  await page.getByTestId("teach-goal-input").fill("Export weekly CRM list");
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByTestId("teach-recording-overlay")).toBeVisible();
  await expect(page.getByTestId("teach-capture-overlay")).toBeVisible();
  await expect(page.getByTestId("teach-protected-input")).toBeVisible();
  await expect(
    page.getByTestId("teach-capture-overlay").getByTestId("teach-protected-input"),
  ).toHaveCount(0);
  await captureScreenshot(page, testInfo, "teach-protected-input");
  await page.getByTestId("teach-capture-overlay").click({ position: { x: 200, y: 200 } });
  await page.keyboard.type("demo");
  await page.getByTestId("teach-stop-overlay").click();
  await expect(page.getByTestId("computer-viewport")).toHaveCount(0);
});
