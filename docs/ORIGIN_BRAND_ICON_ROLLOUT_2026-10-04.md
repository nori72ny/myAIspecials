# ORIGIN Brand Icon Rollout — 2026-10-04

Owner direction: unify the installed app icon, favicon, and in-app visible marks with the approved warm sunrise ORIGIN identity.

## Applied

- `public/favicon.svg`: compact small-size ORIGIN sunrise favicon.
- `public/origin-app-icon.svg`: primary installed-app icon with the sunrise mark on a deep midnight rounded square.
- `public/origin-app-icon-maskable.svg`: safe-zone maskable variant.
- `public/manifest.json` and `public/manifest.webmanifest`: reference the new SVG app icons.
- `index.html`: new favicon reference and brand-aligned browser theme color.
- `public/sw.js`: caches the new brand assets while retaining legacy raster icon files as compatibility fallbacks.
- `src/origin-top-ui.css`: replaces the header status dot and home `◈` mark visually with the approved ORIGIN sunrise mark without changing functional DOM/test IDs.

## Preserved

Legacy PNG icons remain in the repository so existing install/cache compatibility and raster-dimension release tests are not destructively removed. The Apple touch PNG remains a compatibility fallback until a raster write path is available for a verified 180x180 replacement.

## Release gate

Do not merge unless exact-head Production Release, ACOS, CodeQL, OpenSSF, responsive E2E and Lighthouse are green.
