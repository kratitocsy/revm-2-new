# Mobile Home (React island)

The mobile homepage redesign, ported from the Figma Make prototype into a
real React component. This is the first React piece in the codebase —
everything else is vanilla JS/HTML (see `docs/MODULARIZATION.md`).

**Why React here and not a full Next.js rewrite:** the site deploys as
flat static files (see `vercel.json` / how every other page is served),
and both the Tauri desktop app and the Capacitor mobile app load pages
directly rather than running a Node server behind them — so SSR, API
routes, and everything else Next.js is actually for aren't usable here.
This is a plain client-rendered SPA, same deploy model as the rest of
the site.

**Why Tailwind:** the design (`MobileHome.tsx`) came out of Figma Make
already written in Tailwind utility classes. Rather than hand-translate
those into new CSS, the project's existing Tailwind v3 pipeline
(`tailwind.config.js` / `npm run build:css`) now actually compiles them —
worth noting this is the first page where Tailwind's output
(`src/styles/tailwind.build.css`) has real content; it was previously
configured but unused everywhere except `privacy.html`.

## Files

- `MobileHome.tsx` — the component (ported from Figma Make's `App.tsx`,
  renamed from the generic `App` export)
- `main.tsx` — mounts it to `#root`, pulls in Tailwind's compiled output
  plus `mobile-home.css`
- `mobile-home.css` — the handful of things in the Figma export that
  aren't Tailwind utilities (font import, keyframes, scrollbar hiding)
- `mobile-home.html` — Vite's dev/build entry template

## Commands

```
npm run dev:mobile-home     # local dev server with HMR
npm run build:mobile-home   # builds Tailwind CSS, then the bundle —
                             # outputs mobile-home.html + assets/mobile-home-*
                             # to the repo root, same as every other page
```

## Status

Currently a standalone preview page (`mobile-home.html`), not wired into
site navigation or Supabase yet. All state (topics, screen, etc.) is
local React state seeded with the Figma prototype's placeholder data —
next step is replacing that with real Supabase queries using the
existing auth pattern (`sb.auth.getSession()` → bearer token →
`admin.auth.getUser(token)`).

## A note on the Vite config

`vite.mobile-home.config.js` sets `root` to this folder explicitly.
Skipping that is a trap: without it, Vite resolves this app's own
`mobile-home.html` relative to the *repo* root, which (a) makes the
build output nest under `src/apps/mobile-home/` inside `outDir` instead
of landing at the repo root, actually overwriting this source template
with the built one, and (b) makes Vite treat the `/manifest.json` and
`/icon-192.png` hrefs in the `<head>` as real files to resolve and
bundle (since they *do* exist at repo root), fingerprinting and copying
them redundantly instead of leaving them as plain root-relative paths
for the deployed domain to serve. Both bit me while setting this up.
