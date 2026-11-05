import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { maxBuffer: 10 * 1024 * 1024 },
)
  .toString()
  .split("\0")
  .filter(Boolean);
const historical = /^(CHANGELOG\.md|packages\/db\/prisma\/migrations\/)/;
const oldBrand = /Rakazo|@rakazo\/|rakazo\.com\b/;
const compatibility = [
  {
    files: /^apps\/mobile\//,
    identifiers: /"Rakazo(?:Notifications|NetworkCache|VoiceChat|FileDrop|PdfView|FoldRegions)"/g,
  },
  {
    files:
      /^(packages\/(page-kit\/src\/runtime|core\/src\/artifact-sandbox)|apps\/api\/src\/script-assets)(\.test)?\.(tsx?|js)$/,
    identifiers: /\bRakazoPage\b/g,
  },
  { files: /^apps\/desktop\/src\/main\.ts$/, identifiers: /app\.setName\("Rakazo"\)/g },
  { files: /^apps\/desktop\/package\.json$/, identifiers: /"executableName": "Rakazo"/g },
  { files: /^apps\/www\/(middleware\.ts|vercel\.json)$/, identifiers: /rakazo\.com/g },
];
const failures = [];
for (const file of files) {
  if (historical.test(file) || file === "scripts/check-brand.mjs" || !existsSync(file)) continue;
  const content = readFileSync(file);
  if (content.includes(0)) continue;
  const allowed = compatibility.filter((entry) => entry.files.test(file));
  for (const [index, line] of content.toString().split("\n").entries()) {
    const display = allowed.reduce((value, entry) => value.replace(entry.identifiers, ""), line);
    if (oldBrand.test(display)) failures.push(`${file}:${index + 1}`);
  }
}
if (failures.length) {
  console.error(`Old branding remains:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(
    "No old display name, package scope, or public domain remains outside compatibility and historical records.",
  );
}
