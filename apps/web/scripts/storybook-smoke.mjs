import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const [base = "http://127.0.0.1:6006", filter = ""] = process.argv.slice(2);
const shots = process.env.STORYBOOK_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const index = await (await fetch(`${base}/index.json`)).json();
const stories = Object.values(index.entries).filter(
  (entry) => entry.type === "story" && entry.id.includes(filter),
);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
let problems = [];
page.on("console", (message) => {
  const text = message.text();
  if (message.type() === "error" && !text.startsWith("Failed to load resource"))
    problems.push(`console: ${text}`);
  if (message.type() === "warning" && text.startsWith("[storybook]")) problems.push(text);
});
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
page.on("response", (response) => {
  if (response.status() >= 400) problems.push(`http ${response.status()}: ${response.url()}`);
});

let failed = 0;
for (const story of stories) {
  problems = [];
  await page.goto(`${base}/iframe.html?id=${story.id}&viewMode=story`);
  await page
    .waitForSelector("#storybook-root > *, .sb-show-errordisplay", { timeout: 20_000 })
    .catch(() => problems.push("nothing rendered"));
  await page.waitForTimeout(1_000);
  if (await page.locator(".sb-show-errordisplay").count())
    problems.push(`story error: ${await page.locator("#error-message").textContent()}`);
  if (shots) await page.screenshot({ path: path.join(shots, `${story.id}.png`) });
  const unique = [...new Set(problems)].map((problem) => problem.slice(0, 300));
  if (unique.length) failed += 1;
  console.log(`${unique.length ? "FAIL" : "ok  "} ${story.id}`);
  for (const problem of unique) console.log(`     ${problem}`);
}
await browser.close();
console.log(`\n${stories.length - failed}/${stories.length} stories render cleanly`);
process.exit(failed || !stories.length ? 1 : 0);
