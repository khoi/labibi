import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { botDood, DOOD_EYE_INK, DOODLE_DOOD, doodSvgMarkup } from "@labradoodle/core";
import { chromium } from "@playwright/test";
import { JOB_BOT_DOODS } from "../src/job-bots.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

mkdirSync(join(root, "public/brand/job-bots"), { recursive: true });
for (const { slug, color } of Object.values(JOB_BOT_DOODS)) {
  const svg = doodSvgMarkup(botDood(color, slug), { size: 96, eyeInk: DOOD_EYE_INK.light });
  writeFileSync(join(root, `public/brand/job-bots/${slug}.svg`), `${svg}\n`);
}

// Doodle, the yellow coil every agent starts as, is the mascot in the press kit.
const doodle = doodSvgMarkup(DOODLE_DOOD, { size: 700, eyeInk: DOOD_EYE_INK.light });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 700, height: 700 } });
await page.setContent(`<body style="margin:0">${doodle}</body>`);
for (const [name, size] of [
  ["labradoodle-mascot.png", 700],
  ["labradoodle-mascot-preview.png", 400],
] as const) {
  await page.setViewportSize({ width: size, height: size });
  await page.evaluate((px) => {
    const svg = document.querySelector("svg")!;
    svg.setAttribute("width", String(px));
    svg.setAttribute("height", String(px));
  }, size);
  await page.screenshot({ path: join(root, "public/brand/kit", name), omitBackground: true });
}
await browser.close();
