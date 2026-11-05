import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("creation actions stay visible above a long bot list", async ({ page }, testInfo) => {
  await signup(page, `create-menu-${Date.now()}@rakazo.test`, "password12", "Create menu");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);
  for (let index = 0; index < 12; index++) {
    await rpc(page, "bots/create", {
      name: `Helper ${index + 1}`,
      notifyOnFinish: true,
      computerMode: "team",
    });
  }
  await page.reload();
  await page.getByTestId("create-menu-trigger").click();
  const picker = page.getByTestId("bot-create-picker");
  const group = picker.getByTestId("create-new-group");
  const space = picker.getByTestId("create-new-space");
  const firstBot = picker.locator('[data-testid^="picker-bot-"]').first();
  await expect(picker.locator('[data-testid^="picker-bot-"]')).toHaveCount(13);
  const groupBox = await group.boundingBox();
  const botBox = await firstBot.boundingBox();
  expect(groupBox!.y).toBeLessThan(botBox!.y);
  await picker.locator('[data-testid^="picker-bot-"]').last().scrollIntoViewIfNeeded();
  await expect(group).toBeInViewport();
  await expect(space).toBeInViewport();
  await captureScreenshot(page, testInfo, "create-menu-long-roster");
  await page.setViewportSize({ width: 900, height: 360 });
  const lastBot = picker.locator('[data-testid^="picker-bot-"]').last();
  await lastBot.scrollIntoViewIfNeeded();
  await expect(lastBot).toBeInViewport({ ratio: 1 });
  await expect(group).toBeInViewport({ ratio: 1 });
  await expect(space).toBeInViewport({ ratio: 1 });
  await captureScreenshot(page, testInfo, "create-menu-short-window");
  await group.click();
  await expect(page.getByTestId("side-panel")).toHaveAttribute("data-panel", "create-group");
});
