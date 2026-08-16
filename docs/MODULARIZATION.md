# Codebase structure & modularization guide

This describes the module layout introduced to make the repo workable for a
team instead of one person. **No page URLs, script tags, or runtime behavior
changed** — every `.html` file still lives at the repo root and loads
`shared.js` and `style.css` exactly as before. What changed is *how those
two files are authored*.

## TL;DR for new contributors

- Don't hand-edit `shared.js` at the repo root — it's a **generated build
  output**. Edit the real source under `src/lib/`, then run:
  ```
  npm install
  npm run build:shared
  ```
  This regenerates `shared.js` and you commit both the `src/lib/` change and
  the regenerated `shared.js`.
- Page-specific CSS lives in `src/styles/pages/<page>.css`, linked from each
  `.html` file's `<head>`. Shared/base CSS is `style.css` at the root
  (unchanged) — a copy of it also lives at `src/styles/base.css` for
  reference/future consolidation, but `style.css` at root is still what's
  actually linked from every page today.
- The big multi-thousand-line page files (`groups.html`, `blocks.html`,
  `tracker.html`, `timer.html`) have **not** been split yet — see "What's
  still monolithic" below.

## Why `shared.js` is a build output, not hand-written

The old `shared.js` was 1,259 lines mixing config, auth, date utilities, an
animated logo component, call/notification UI, etc. — one file, no
boundaries, everyone editing the same place.

It's now authored as ~20 small ES modules under `src/lib/`:

```
src/lib/
├── index.js                 ← barrel: imports everything, exposes it on window
├── core/
│   ├── config.js             REVM2_CONFIG, INTERVALS
│   ├── store.js               localStorage helpers (Store)
│   ├── format.js             date/text formatting, escHtml/escAttr
│   ├── nav.js                 go(), goInvite()
│   ├── auth.js                 signOutRevM2, requireAuth, desktop auth sync
│   ├── analytics.js           logEvent()
│   ├── tracker-sync.js        Supabase sync for the Ebbinghaus tracker
│   └── exam-switcher.js       sidebar exam-track switcher
└── ui/
    ├── typography-reveal.js
    ├── starfield.js
    ├── sound.js               rocket launch sound + mute toggle state
    ├── logo.js                 RevM2Logo (animated SVG logo component)
    ├── loading-overlay.js     RevM2Loader
    ├── call-ringtone.js       ringtone + browser Notification for calls
    ├── incoming-call-toast.js RevM2Calls — cross-page call toast
    ├── unread-badges.js       RevM2Notifications — sidebar unread badges
    ├── mobile-sidebar.js      hamburger drawer
    ├── sidebar-hover.js       desktop hover-reveal sidebar
    └── animate.js             rm2AnimateNumber, rm2Stagger
```

Each file imports only what it actually needs from the others (checked
programmatically during the split — see git history — no cross-file
reference was missed or left dangling).

**Why this still compiles down to one plain `shared.js`, and not
`type="module"`:** every page loads it as
`<script src="shared.js"></script>`, frequently followed *on the very next
line* by another plain script that calls a shared function synchronously
(e.g. `initStarfield()` right after the tag). Dozens of `onclick="..."`
attributes across the HTML also call shared functions directly, which only
works if those functions are real globals. A `type="module"` script is
deferred by the browser and its exports are *not* globals — switching to it
would silently break load order and every inline handler on every page. So
`vite.shared.config.js` bundles `src/lib/index.js` into a classic
synchronous IIFE that assigns every export onto `window`, byte-for-byte
matching the old file's runtime behavior. (This was verified: every
publicly-referenced symbol from the original `shared.js` was diffed against
the built output, and the built bundle was executed in a sandboxed DOM stub
to confirm it runs without throwing and every global — `Store`, `escHtml`,
`REVM2_CONFIG`, `RevM2Logo`, `requireAuth`, etc. — behaves identically.)

## CSS

Each page's inline `<style>` block was extracted verbatim into
`src/styles/pages/<page>.css` and swapped for
`<link rel="stylesheet" href="src/styles/pages/<page>.css">` at the exact
same position in `<head>` — so cascade order is unchanged. This part needed
no build step (CSS has no load-order/global-scope hazards the way the JS
did), so it's a plain 1:1 move, already live in every page.

## groups.html — extracted, not yet split further

`groups.html`'s 3,056-line inline `<script>` block is now
`src/pages/groups.page.js`, loaded via
`<script src="src/pages/groups.page.js"></script>` at the exact same
position. This alone cut `groups.html` from 3,515 lines to 459 — the
markup is now readable on its own, diffable in PRs without JS noise, and
the JS is a real file a linter/editor can navigate.

**This was a verbatim, zero-risk move** (checked byte-for-byte identical to
what was removed, plus `node --check` for valid syntax) — nothing inside
the script was reordered or touched.

**It was deliberately *not* split further into per-feature files**, and
that's worth understanding before attempting it: the same
extract → auto-detect-imports process used for `shared.js` was tried here
first, splitting by the code's own comment sections (video call, friend
requests, chat badges, stats tab, drive import, etc.). The result showed
**real circular dependencies** — e.g. the video-call code and the
friend-request code call into each other both ways, and the stats tab
reaches into `group-detail`, `drive-import`, `sharing`, and `focus-time`,
each of which reaches back into it. Unlike `shared.js` (genuinely
independent utilities), these "sections" are visual groupings, not real
module boundaries — the whole file is one tightly-coupled page controller.

Splitting a file like that into multiple modules with circular imports
doesn't reduce coupling, it just hides the same tangle behind more files,
and introduces a real correctness risk (circular `let`/`const` module
bindings can throw "cannot access before initialization" depending on
evaluation order) that can't be ruled out here the way it was for
`shared.js` — WebRTC/mesh-call code isn't something that can be safely
executed in a sandboxed Node `vm` stub to prove it still works.

**If someone wants to properly decompose `groups.page.js` later**, that's
a real refactor, not a mechanical split — it needs an actual shared-state
pattern (e.g. a small store/event-bus the sub-modules talk through instead
of calling each other directly) designed by someone who knows the call/
friend-request/chat interactions, plus manual testing of the video call
flow. Don't attempt it with the same auto-import-detection script used for
`shared.js` — the circular-dependency check above will tell you why.

## What's still monolithic (good next targets)

These were **not** touched in this pass — each is a bigger, higher-risk job
that deserves its own careful pass with the same "extract, verify, diff"
discipline used for `shared.js` and `groups.html`:

- `blocks.html` (2.2k lines), `tracker.html` (2k), `timer.html` (1.9k),
  `partners.html` (1.3k) — each is a full page's HTML + inline `<script>`
  logic in one file, same shape `groups.html` was. First check for
  circular coupling the same way (auto-map imports, look for mutual
  pairs) before deciding whether a real split or just a verbatim
  extraction (like `groups.page.js`) is the safe move.
- `materials.js`, `materials-viewer.js`, `ads.js` — already separate files,
  but each is a single undivided module (285–605 lines) and could be split
  by concern the same way `shared.js` was, once checked for coupling.

**Playbook for each**, refined from this pass:
1. Extract the inline `<script>` block verbatim into `src/pages/<name>.page.js`
   first — zero-risk, immediate clutter reduction, always worth doing.
2. Map every top-level function/const and every place it's called from
   (inline `<script>`, `onclick=`, other files) — script this, don't do
   it by hand.
3. Auto-detect cross-reference imports if you attempt a further split, and
   explicitly check for mutual/circular pairs before trusting the result
   (see groups.html above for why this matters).
4. If it's a clean DAG (like `shared.js` was): split, bundle back via Vite
   `lib`/`iife`, verify by diffing the public symbol list and executing the
   built file in a sandboxed DOM stub.
5. If it's circularly tangled (like `groups.html` was): stop at step 1,
   document why, and flag it as needing a real refactor rather than a
   mechanical split.

## Build tooling

[Vite](https://vitejs.dev) was chosen because:
- It's already the tool Tauri's own docs recommend, so the desktop app's
  future build tooling can share the same config patterns.
- It supports library/IIFE output out of the box (`build.lib`), which is
  what let `shared.js` stay a single classic script with zero HTML changes.
- It's the natural next step if/when the big pages above get split into a
  real multi-page bundle — `vite.shared.config.js` can be extended into a
  second config with each `.html` file as an entry point, still outputting
  flat to the repo root so Vercel/Tauri/Capacitor paths don't change.

Run `npm install` once, then `npm run build:shared` after any edit under
`src/lib/`. `npm run dev:shared` watches for changes.
