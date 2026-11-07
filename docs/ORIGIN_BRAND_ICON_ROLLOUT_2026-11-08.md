# ORIGIN Brand Icon Rollout — Ribbon O + Cat (2026-11-08)

Owner direction: replace the sunrise identity with the approved "ribbon O" logo (案H) and introduce the cat character (wearing the logo ribbon) in status displays.

## Logo assets (`public/brand/`)

- `origin-ribbon-o.webp`: primary mark — pearl-white ribbon O on midnight blue (master).
- `origin-ribbon-o-small.webp`: simplified small-size variant for tiny surfaces.
- `origin-ribbon-o-light.webp`: navy ribbon O on cream, for light-theme surfaces.
- `origin-ribbon-o-mono.webp`: flat monochrome variant; also the source of the dark-scheme favicon.

## Platform assets (`public/`)

- `favicon.png` (64×64, from the small variant) and `favicon-dark.png` (64×64, from the mono variant, `prefers-color-scheme: dark`).
- `pwa-192.png`, `pwa-512.png`, `apple-touch-icon.png` (180×180): regenerated from the master.
- `pwa-maskable-512.png`: master scaled into the maskable safe zone on the midnight-blue background.
- All icon URLs carry the cache version `?v=ribbon-20261108` (supersedes `sunrise-20261004`).
- These PNGs are build-time outputs of `scripts/generate-origin-brand-icons.mjs` (run by the `origin-brand-raster` Vite plugin on every dev/test/build, as before). The script now rasterizes the approved artwork from `scripts/brand/origin-ribbon-o{,-small,-mono}-source.png` (filter-0 PNGs) instead of drawing the retired sunrise design procedurally; the maskable background is sampled from the master artwork's own corner pixel.

## In-app surfaces

- Startup splash (`SplashScreen`): master mark; halo/aurora retinted to the midnight-blue family; class prefix renamed `origin-sunrise-*` → `origin-ribbon-*`.
- Header mark (22px): small variant.
- Home core logo (64px): light variant on the light theme, master on the dark theme (`:root[data-theme="dark"]` override); glow retinted to midnight blue.
- `public/sw.js` precaches the new brand set; retired sunrise assets (`favicon.svg`, `origin-app-icon.svg`, `origin-app-icon-maskable.svg`, `brand/origin-sunrise-mark.svg`) are removed.

## Cat character (`src/components/OriginCatState.tsx`)

State stills live in `public/brand/origin-cat-<state>.webp` (extracted from the approved state clips) and are precached by the service worker. Placement is limited to existing status UI:

| Surface | State | Visual |
| --- | --- | --- |
| Chat thinking chip (`origin-thinking`) | thinking | still |
| Agent status row — capability check / planning | thinking | still |
| Agent status row — awaiting approval | waiting | still |
| Agent status row — executing | working | video (see below) |
| Agent status row — completed | done | still |
| Agent status row — failed / unavailable | sorry | still |
| Agent status row — idle | sleep | still |

Performance rules: stills are the default everywhere; the only video is
`origin-cat-working.mp4` (480×480, ≈200KB, re-encoded from the 960×960 master
clip), rendered only while the agent is executing, never precached, and
replaced by its still under `prefers-reduced-motion`.
