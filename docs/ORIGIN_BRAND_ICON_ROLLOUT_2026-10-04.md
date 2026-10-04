# ORIGIN Brand Icon Rollout — 2026-10-04

Owner direction: unify the installed app icon, favicon, Apple touch icon, and in-app visible marks with the approved warm sunrise ORIGIN identity.

## Applied

- `public/favicon.svg`: compact small-size ORIGIN sunrise favicon.
- `public/origin-app-icon.svg`: scalable app-icon source with the sunrise mark on a deep midnight rounded square.
- `public/origin-app-icon-maskable.svg`: scalable safe-zone maskable source.
- `public/pwa-192.png`: 192x192 raster PWA icon regenerated from the approved identity.
- `public/pwa-512.png`: 512x512 raster PWA icon regenerated from the approved identity.
- `public/pwa-maskable-512.png`: 512x512 safe-zone raster maskable icon.
- `public/apple-touch-icon.png`: 180x180 Apple touch icon regenerated from the approved identity.
- `public/manifest.json` and `public/manifest.webmanifest`: use the raster PWA icons for broad installed-app compatibility.
- `index.html`: uses the new SVG favicon, regenerated Apple touch icon, and brand-aligned browser theme color.
- `public/sw.js`: caches the complete new favicon/app-icon/brand asset set.
- `src/origin-top-ui.css`: replaces the header status dot and home `◈` mark visually with the approved ORIGIN sunrise mark without changing functional DOM/test IDs.

## Brand source preservation

The approved reusable brand mark remains `public/brand/origin-sunrise-mark.svg`. The scalable app-icon SVG variants remain alongside the raster platform assets so future surfaces can reuse the same identity without regenerating the concept.

## Release gate

Do not merge unless exact-head Production Release, ACOS, CodeQL, OpenSSF, responsive E2E, Lighthouse, and PWA boundary checks are green.
