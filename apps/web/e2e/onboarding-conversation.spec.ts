import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

function slackCard(page: Page) {
  return page.getByRole("group", { name: "Slack connection" });
}

test("the first chat welcomes with app cards and preserves a completed connection", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `onboarding-${stamp}@labradoodle.test`, "password12", "Robin");
  await completeOnboarding(page);

  await expect(page.getByText(/^Welcome to Labradoodle/)).toBeVisible();
  await expect(slackCard(page)).toBeVisible();
  await expect(page.getByRole("group", { name: "Gmail connection" })).toBeVisible();
  const connectionCards = page.getByRole("group", { name: / connection$/ });
  const cardBoxes = await connectionCards.evaluateAll((cards) =>
    cards.map((card) => {
      const { bottom, top } = card.getBoundingClientRect();
      return { bottom, top };
    }),
  );
  expect(cardBoxes.length).toBeGreaterThan(1);
  expect(cardBoxes[1]!.top - cardBoxes[0]!.bottom).toBeGreaterThanOrEqual(8);
  await page.mouse.move(1, 1);
  await captureScreenshot(page, testInfo, "01-welcome-app-cards");
  const authorizeButton = slackCard(page).getByRole("button", { name: "Connect", exact: true });
  const restingBackground = await authorizeButton.evaluate(
    (button) => getComputedStyle(button).backgroundColor,
  );
  await authorizeButton.hover();
  await expect
    .poll(() => authorizeButton.evaluate((button) => getComputedStyle(button).backgroundColor))
    .not.toBe(restingBackground);
  await captureScreenshot(page, testInfo, "02-app-suggestions-authorize-hover");

  await authorizeButton.click();
  await expect(slackCard(page).getByText("Connected", { exact: true })).toBeVisible();
  await expect(slackCard(page).getByText("Connected", { exact: true })).toHaveCSS("opacity", "1");
  await expect
    .poll(async () => {
      const connections = await rpc<Array<{ provider: string; status: string }>>(
        page,
        "connections/list",
        {},
      );
      return connections.some(
        (connection) => connection.provider === "SLACK" && connection.status === "connected",
      );
    })
    .toBe(true);
  await page.mouse.move(1, 1);
  await captureScreenshot(page, testInfo, "03-slack-connected");

  await page.reload();
  await expect(slackCard(page).getByText("Connected", { exact: true })).toBeVisible();
  await page.mouse.move(1, 1);
  await captureScreenshot(page, testInfo, "04-connected-after-reload");
});
