import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = new URL("../../../", import.meta.url);
const path = (name: string) => fileURLToPath(new URL(name, root));

// Doodle's coil is the only source: every icon, mark and splash is drawn from it.
const coil = await sharp(path("packages/ui-tokens/assets/doodle.svg"), { density: 600 })
  .trim()
  .png()
  .toBuffer();
const plate = "#FFFFFF";

/** The coil, its longer side `share` of a `size` canvas, centred on `background`. */
async function art(size: number, share: number, background = "#00000000") {
  const side = Math.round(size * share);
  const glyph = await sharp(coil)
    .resize(side, side, { fit: "contain", background: "#00000000" })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: glyph, gravity: "centre" }])
    .png()
    .toBuffer();
}

function mask(size: number, inset: number, radius: number) {
  const side = size - inset * 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect x="${inset}" y="${inset}" width="${side}" height="${side}" rx="${radius}" fill="white"/></svg>`,
  );
}

async function clip(input: Buffer, size: number, inset: number, radius: number) {
  return sharp(input)
    .composite([{ input: mask(size, inset, radius), blend: "dest-in" }])
    .png()
    .toBuffer();
}

// The opaque square app icon, and the same plate rounded for browser and marketing marks.
const square = await art(1024, 0.62, plate);
const rounded = await clip(square, 1024, 0, 200);

async function png(input: Buffer, name: string, size: number) {
  await sharp(input).resize(size, size).png().toFile(path(name));
}

// PNG frames in ICO are supported by modern Windows and browser favicon loaders.
async function ico(input: Buffer, name: string, sizes: number[]) {
  const frames = await Promise.all(sizes.map((size) => sharp(input).resize(size).png().toBuffer()));
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16;
    const size = sizes[index] ?? 0;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frame.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frame.length;
  });
  await writeFile(path(name), Buffer.concat([header, ...frames]));
}

for (const app of ["web", "www"]) {
  const publicDir = `apps/${app}/public`;
  await png(rounded, `${publicDir}/favicon-16x16.png`, 16);
  await png(rounded, `${publicDir}/favicon-32x32.png`, 32);
  await png(rounded, `${publicDir}/favicon.png`, 128);
  await png(square, `${publicDir}/apple-touch-icon.png`, 180);
  await png(square, `${publicDir}/icon-192.png`, 192);
  await png(square, `${publicDir}/icon-512.png`, 512);
  await ico(rounded, `${publicDir}/favicon.ico`, [16, 32, 48]);
}
await mkdir(path("apps/www/public/brand/kit"), { recursive: true });
await png(rounded, "apps/www/public/brand/labradoodle-mark.png", 256);
await png(rounded, "apps/www/public/brand/kit/labradoodle-icon.png", 1024);
await sharp(rounded).resize(400).webp().toFile(path("apps/www/public/brand/kit/labradoodle-icon-preview.webp"));
await png(rounded, "apps/mobile/assets/favicon.png", 128);
await png(square, "apps/mobile/assets/icon.png", 1024);
await png(square, "apps/mobile/ios-widgets/Assets.xcassets/AppMark.imageset/app-mark.png", 180);
await png(square, "apps/desktop/assets/icon.png", 1024);
await ico(rounded, "apps/desktop/assets/icon.ico", [16, 32, 48, 64, 128, 256]);

// macOS before Tahoe: the 824-point rounded plate inside the 1024 canvas, leaving the Dock margin.
await sharp(await clip(await art(1024, 0.5, plate), 1024, 100, 185))
  .png()
  .toFile(path("apps/desktop/assets/icon-macos.png"));

// Icon Composer's layer: the coil alone; the bundle paints the white plate.
await sharp(await art(1024, 0.62)).png().toFile(path("packages/ui-tokens/assets/Labradoodle.icon/Assets/doodle.png"));

// Android: the coil sits inside the launcher's 66% safe circle on a white background layer.
await sharp(await art(1024, 0.46)).png().toFile(path("apps/mobile/assets/adaptive-icon.png"));
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: plate } })
  .png()
  .toFile(path("apps/mobile/assets/icon-background.png"));
const silhouette = await sharp(await art(1024, 0.46)).extractChannel("alpha").png().toBuffer();
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "black" } })
  .joinChannel(silhouette)
  .png()
  .toFile(path("apps/mobile/assets/monochrome-icon.png"));

// The splash shows the coil alone, with no plate, so it sits on either splash colour.
await sharp(await art(620, 1))
  .extend({ top: 202, bottom: 202, left: 202, right: 202, background: "#00000000" })
  .png()
  .toFile(path("apps/mobile/assets/splash-icon.png"));

// Android notification icons must be white alpha silhouettes.
await sharp({ create: { width: 72, height: 72, channels: 3, background: "white" } })
  .joinChannel(await sharp(silhouette).resize(72, 72).png().toBuffer())
  .png()
  .toFile(path("apps/mobile/assets/notification-icon.png"));

// The lockup: the mark beside the wordmark, as the press kit offers it.
const word = await sharp(path("apps/www/public/brand/kit/labradoodle-wordmark.svg"), { density: 900 })
  .resize({ height: 300 })
  .png()
  .toBuffer();
const wordWidth = (await sharp(word).metadata()).width ?? 0;
const lockup = await sharp({
  create: { width: 576 + 120 + wordWidth, height: 576, channels: 4, background: "#00000000" },
})
  .composite([
    { input: await sharp(rounded).resize(576).toBuffer(), left: 0, top: 0 },
    { input: word, left: 696, top: 138 },
  ])
  .png()
  .toBuffer();
await sharp(lockup).toFile(path("apps/www/public/brand/kit/labradoodle-logo.png"));
await sharp(lockup).resize({ width: 1000 }).webp().toFile(path("apps/www/public/brand/kit/labradoodle-logo-preview.webp"));
