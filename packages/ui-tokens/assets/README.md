# App icon source

`doodle.svg` is the one source for every icon: Doodle's yellow coil, the dood every bot
starts as. `pnpm --filter @labradoodle/ui-tokens export:brand` draws all platform
exports from it:

- `Labradoodle.icon`: the Icon Composer bundle for macOS and iOS. Its layer is the coil
  alone on a white fill. macOS packaging compiles it into a Tahoe asset catalog and
  generates the legacy ICNS fallback; Expo copies it into the iOS project.
- `apps/desktop/assets/icon-macos.png`: the pre-Tahoe export with Dock margins.
- `apps/desktop/assets/icon.png` and `icon.ico`: Linux and Windows.
- `apps/mobile/assets/icon.png`: opaque 1024-pixel square for the generic icon.
- `apps/mobile/assets/adaptive-icon.png`, `icon-background.png` and
  `monochrome-icon.png`: the Android layers, with the coil inside the launcher's safe
  circle on white. The notification icon is the monochrome silhouette.
- `apps/mobile/assets/splash-icon.png`: the coil alone, so it sits on either splash colour.
- Web and marketing favicons, install icons, the iOS widget mark, the marketing mark,
  and the press-kit icon and logo lockup.

After exporting, run `pnpm exec tsx apps/www/scripts/render-og.mjs` to refresh the
marketing page social cards; set `CHROME_PATH` to a headless Chrome executable when
it is not available at the script's default location.

## Doods

Bots are drawn as doods: one of eight hand-drawn strokes in one of seven inks, with
eyes, defined in `packages/core/src/dood.ts`. On the web, `dood.riv` animates them;
mobile and still images draw the same strokes as SVG. `apps/www/scripts/render-doods.ts`
renders the site's job-bot doods and the press-kit mascot.
