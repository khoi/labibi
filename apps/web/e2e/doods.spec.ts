import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test.use({ viewport: { width: 1000, height: 460 } });

for (const theme of ["dark", "light"]) {
  test(`doods animate every body and activity in ${theme}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(`/e2e/fixtures/doods.html?theme=${theme}`);
    const animated = page.locator('[data-slot="dood"][data-rive]');
    await expect(animated).toHaveCount(18);
    await expect(page.locator('[data-slot="dood"][data-rive="shown"]')).toHaveCount(18, {
      timeout: 20_000,
    });
    // Rive blends each look in; give the last ones time to settle before the still.
    await page.waitForTimeout(1500);
    await captureScreenshot(page, testInfo, `doods-${theme}`);
    expect(errors).toEqual([]);
  });
}

test("reduced motion keeps the still SVG dood and never loads Rive", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const rive: string[] = [];
  page.on("request", (request) => {
    if (/\.riv|rive.*\.wasm/.test(request.url())) rive.push(request.url());
  });
  await page.goto("/e2e/fixtures/doods.html");
  await expect(page.locator('[data-slot="dood"]')).toHaveCount(19);
  await expect(page.locator('[data-slot="dood"][data-rive]')).toHaveCount(0);
  expect(rive).toEqual([]);
});
