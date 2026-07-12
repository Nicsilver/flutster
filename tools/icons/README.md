# Flutster icon generator

Single source of truth for every launcher icon, favicon, and banner. All assets
are derived from **"the Original"** — a circular audio-waveform mark on the
Berry Punch palette (pink `#ff3d81` → violet `#b026ff` → indigo `#5b2bff`,
near-black plum `#0e0a18`, warm ink `#fdeee6`) that mirrors the card-maker theme.

## Regenerate everything

```bash
cd tools/icons
npm install
npm run generate
```

`generate.js` renders SVG → PNG with `@resvg/resvg-js` and writes:

| Output | Purpose |
| --- | --- |
| `app/assets/icon/icon.png` | Legacy launcher + `flutter_launcher_icons` source |
| `app/assets/icon/foreground.png` | Adaptive-icon foreground layer |
| `app/assets/icon/monochrome.png` | Themed-icon (Android 13+) layer |
| `app/store/play_store_512.png` | Google Play listing icon (gitignored) |
| `screenshots/social-banner.png` | GitHub social preview (1280×640) |
| `card-maker/public/favicon.{svg,ico}` + `favicon-16/32`, `apple-touch-icon`, `icon-192/512`, `maskable-512` | Web favicons + PWA icons |
| `card-maker/public/og-image.png` | Open Graph / Twitter card (1200×630) |

## After regenerating the Android source PNGs

Re-run the launcher-icon pipeline so the mipmaps + adaptive XML pick up changes:

```bash
cd app
dart run flutter_launcher_icons
```

Config lives in `app/pubspec.yaml` under `flutter_launcher_icons`
(background `#0E0A18`, foreground, monochrome).

## Tweaking the design

Edit the palette constants or `waveGroup()` geometry at the top of
`generate.js`. The amplitude curve (`amp()`) is the exact "Original" music curve —
change it only if you want a different waveform shape.
