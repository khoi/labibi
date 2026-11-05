import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, openBotPanelTab, signup } from "./helpers";

test("bot settings open Avatar Studio on the Bot tab", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `avatar-studio-${stamp}@labradoodle.test`, "password12", "Avatar Studio");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  await page.getByTestId("bot-settings-trigger").click();
  const settings = page.getByTestId("bot-settings");
  await expect(settings).toBeVisible();

  await settings.getByTestId("avatar-studio-trigger").click();
  const studio = page.getByTestId("avatar-studio");
  await expect(studio).toBeVisible();
  await expect(studio.getByText("Avatar Studio", { exact: true })).toBeVisible();
  await expect(studio.getByRole("tab", { name: "Bot", exact: true })).toBeVisible();
  await expect(studio.getByRole("tab", { name: "Upload", exact: true })).toBeVisible();
  await expect(studio.getByTestId("avatar-studio-bot-tab")).toBeVisible();

  await expect(studio.getByRole("tab", { name: "Original", exact: true })).toHaveCount(0);
  const defaultLook = studio.getByTestId("avatar-studio-default");
  const star = studio.getByRole("button", { name: "Shape 6", exact: true });
  const preview = page.getByTestId("avatar-studio").locator('[data-slot="dood"]').first();
  await expect(defaultLook).toHaveAttribute("aria-pressed", "true");
  await expect(star).toHaveAttribute("aria-pressed", "false");

  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await expect(defaultLook).toHaveAttribute("aria-pressed", "false");
  await expect(preview).toHaveAttribute("data-shape", "star");

  await studio.getByRole("button", { name: "Color #4FAA52" }).click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await expect(preview).toHaveAttribute("data-color", "green");

  await studio.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(defaultLook).toHaveAttribute("aria-pressed", "true");
  await expect(star).toHaveAttribute("aria-pressed", "false");

  await star.click();
  await expect(preview).toHaveAttribute("data-rive", "shown", { timeout: 15_000 });
  await captureScreenshot(page, testInfo, "avatar-studio-bot-tab");
  await studio.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await openBotPanelTab(page, "Computer");
  await expect(
    page.getByTestId("bot-settings").locator('[data-slot="dood"][data-shape="star"]').first(),
  ).toBeVisible();
});
