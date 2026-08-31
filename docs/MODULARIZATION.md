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
  (unchanged) — a copy also lives at `src/styles/globals.css` +
  `src/styles/tokens.css` (design tokens split out separately) for
  reference/future consolidation, but `style.css` at root is still what's
  actually linked from every page today.
- The big multi-thousand-line page files (`groups.html`, `blocks.html`,
  `tracker.html`, `timer.html`) have **not** been split yet — see "What's
  still monolithic" below.
- `src/components/`, `src/features/`, and `src/lib/` were reorganized in a
  later pass to mirror a target Next.js-shaped tree (`components/<Name>/`,
  `features/<domain>/`, a flat `lib/{supabase,utils,storage}.js`) —
  **structure only, still plain JS, no framework change.** See
  "components/, features/, lib/ — folder shape" below.

## Why `shared.js` is a build output, not hand-written

The old `shared.js` was 1,259 lines mixing config, auth, date utilities, an
animated logo component, call/notification UI, etc. — one file, no
boundaries, everyone editing the same place.

It's now authored as small ES modules spread across `src/lib/`,
`src/components/`, and `src/features/` (see the next section for why it's
split across three top-level folders and not just one):

```
src/
├── lib/
│   ├── index.js        ← barrel: imports everything below, exposes it on window
│   ├── supabase.js       REVM2_CONFIG (Supabase URL/anon key, Drive/Telegram keys)
│   ├── storage.js         localStorage helpers (Store)
│   └── utils.js           INTERVALS, date/text formatting, go()/goInvite(), logEvent()
├── features/
│   ├── auth/auth.js               signOutRevM2, requireAuth, desktop auth sync
│   └── tracker/tracker-sync.js    Supabase sync for the Ebbinghaus tracker
└── components/
    ├── Sidebar/
    │   ├── Sidebar.js            renderSidebar (build-time only, see below)
    │   ├── mobile-sidebar.js     hamburger drawer
    │   ├── sidebar-hover.js      desktop hover-reveal sidebar
    │   └── exam-switcher.js      sidebar exam-track switcher
    ├── TypographyReveal/TypographyReveal.js
    ├── Starfield/Starfield.js
    ├── SoundToggle/SoundToggle.js         rocket launch sound + mute toggle state
    ├── Logo/Logo.js                        RevM2Logo (animated SVG logo component)
    ├── LoadingOverlay/LoadingOverlay.js   RevM2Loader
    ├── CallRingtone/CallRingtone.js       ringtone + browser Notification for calls
    ├── IncomingCallToast/IncomingCallToast.js  RevM2Calls — cross-page call toast
    ├── UnreadBadges/UnreadBadges.js       RevM2Notifications — sidebar unread badges
    ├── AnimateNumber/AnimateNumber.js     rm2AnimateNumber, rm2Stagger
    ├── Header/Header.js    (not wired into shared.js — see below)
    ├── Modal/Modal.js       (not wired into shared.js — see below)
    └── Button/Button.js     (not wired into shared.js — see below)
```

Each file imports only what it actually needs from the others (checked
programmatically during the original split — see git history — no
cross-file reference was missed or left dangling; re-checked after the
folder reorg the same way, see "components/, features/, lib/ — folder
shape" below).

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

`src/styles/base.css` (a reference-only copy of root `style.css`) was later
split into `src/styles/tokens.css` (just the `:root{...}` custom-property
block — colors, spacing grid, radii, typography vars) and
`src/styles/globals.css` (everything else, `@import`-ing tokens.css) to
match the target `tokens.css` / `globals.css` naming. **Both are still
reference-only, not linked from any page** — root `style.css` remains the
one actually served. While doing this split, `base.css` was found to have
drifted slightly from `style.css` (a stale `.sidebar-logo` padding value,
missing `.sidebar-logo-img`) — `globals.css` was regenerated from the
current `style.css` instead of carrying that drift forward, verified
byte-identical to root `style.css` line-for-line outside the token block.

## components/, features/, lib/ — folder shape

Later reorganized (structure only, still plain JS) to mirror a target
Next.js-shaped tree: `components/<Name>/`, `features/<domain>/`, and a flat
`lib/` with just `supabase.js`/`utils.js`/`storage.js`. What moved:

- **`src/lib/core/*` → flattened into `src/lib/`:** `config.js` renamed
  `supabase.js` (still just config — see file header, no shared client
  instance yet), `store.js` renamed `storage.js`, and `format.js` + `nav.js`
  + `analytics.js` merged into one `utils.js` (they were three small,
  unrelated-to-each-other files, not one cohesive module — merged only
  because the target tree wants a single grab-bag `utils.js`, not because
  they belong together conceptually). `exam-switcher.js` moved to
  `components/Sidebar/` instead (see below) since it's UI behavior tied to
  the sidebar's `#sTrack`/`#sExam` labels, not a generic utility.
- **`src/lib/ui/*` → `src/components/<Name>/<Name>.js`:** every one of
  these was already a standalone, page-agnostic UI widget (Logo,
  LoadingOverlay, CallRingtone, IncomingCallToast, UnreadBadges, Starfield,
  TypographyReveal, SoundToggle, AnimateNumber) — `lib/ui/` was really
  already "components", just not named that. `mobile-sidebar.js` and
  `sidebar-hover.js` went into `components/Sidebar/` alongside `Sidebar.js`
  instead of getting their own folders, since both are literally the
  Sidebar's own behavior (the mobile drawer, the desktop hover-reveal) —
  `sidebar-hover.js` already imported directly from `mobile-sidebar.js`,
  confirming the coupling.
- **`src/pages/groups.page.js` → `src/features/groups/groups.page.js`**
  and **root `materials.js`/`materials-viewer.js` →
  `src/features/materials/`** — both previously flagged in this doc as
  "not yet moved" (see git history for the old wording); moved now, with
  `groups.html`'s three `<script src="...">` tags updated to match.
- **`src/features/focus-lock/README.md`** — placeholder only. Nothing
  extracted here yet; that logic is still inline in `blocks.html`,
  `timer.html`, `admin.html`. Exists so the folder shape matches the
  target `features/` layout, not because extraction happened — see
  "What's still monolithic" below for why that's a separate, harder pass.

**Verification, same discipline as the original split:** `node --check`
on every touched file, `npm run build:shared` rebuilt cleanly, and the
rebuilt `shared.js` was diffed against the pre-reorg version by actually
*executing both* in a sandboxed Node `vm` and comparing the resulting
`window` globals — same 47 globals before and after, nothing added,
nothing missing, and `REVM2_CONFIG`/`INTERVALS`/`EXAM_SWITCH_LIST` plus
several function bodies (`escHtml`, `escAttr`, `fmtTime`, `go`, `Store`,
`fmtDateShort`) confirmed identical via `JSON.stringify`/`.toString()`
comparison, not just visual diffing. `npm run build:sidebars` was also
re-run against the moved `Sidebar.js` — all 10 pages reported
**unchanged**, confirming that move produces byte-identical markup.

One real mistake caught during this verification, worth knowing about if
you're doing a similar pass elsewhere: the first draft of the new
`src/lib/index.js` accidentally added `Header.js`/`Sidebar.js`/`Modal.js`
to the `window`-export bundle. Those three were **not** part of `shared.js`
before (see "not yet wired into any live page" a few paragraphs below) —
adding them would've been a real behavior change disguised as a rename.
Caught by the global-diff step above (`before` had 47 globals, first
`after` attempt had 50) and reverted before rebuilding.

## components/ — deduplicated, page-agnostic markup

The main app sidebar (`<aside class="sidebar">`) was byte-for-byte
duplicated across 10 pages — home, tracker, timer, battle, groups,
chat, partners, store, revhead, blocks (blocks differs only by
omitting the sign-out button; groups/partners/store differ only by
omitting the footer entirely). `pledge.html` has a **genuinely
different** sidebar (different nav items, emoji icons, an "Invite
friends" entry) and is deliberately left untouched — it is not a
duplicate of the standard one.

`src/components/Sidebar/Sidebar.js` is now the single source of truth for
the standard sidebar's markup (data-driven nav item list). It is
stamped into each page at build time by `scripts/build-sidebars.js`
— same philosophy as `shared.js`: the served `.html` stays plain
static markup (no client-side injection, no flash-of-missing-sidebar),
it's just generated instead of hand-copied.

**Don't hand-edit the sidebar block in any of those 10 `.html` files.**
Edit `src/components/Sidebar/Sidebar.js`, then run:
```
npm run build:sidebars
```
and commit both. (Verified: rebuilding with zero config changes
reproduces every page's sidebar as byte-identical markup, whitespace
aside.)

Also in `src/components/`, not yet wired into any live page (each
documents the pattern it replaces and is ready to adopt page-by-page):
- `Modal/Modal.js` — generic open/close/backdrop-click, extracted from the
  shape `src/components/Sidebar/exam-switcher.js` and home.html's
  `logModeModal` both hand-roll separately.
- `Button/Button.js` — the `.btn-spinner` show/hide/disable/relabel dance
  that `login.html` (and others) do by hand on every button.
- `Header/Header.js` — the public/marketing top nav (landing, film,
  product-tour) — parameterized, not consolidated 1:1 like Sidebar,
  since each marketing page's links genuinely differ.

## features/ — feature-owned logic, pulled out of the generic lib/

`src/lib/core/auth.js` → `src/features/auth/auth.js` and
`src/lib/core/tracker-sync.js` → `src/features/tracker/tracker-sync.js`:
these are feature-specific (sign-out/session handling; Ebbinghaus
tracker sync), unlike the truly generic utilities that now live flat in
`src/lib/` (`supabase.js`, `storage.js`, `utils.js`). Moved, re-pointed
their internal imports, and rebuilt `shared.js` — **byte-identical
output**, confirming the move changed nothing at runtime.

`src/features/groups/groups.page.js` and `src/features/materials/` are
covered above. `src/features/focus-lock/` is a placeholder — see above.

## groups.html — extracted, not yet split further

`groups.html`'s 3,056-line inline `<script>` block is now
`src/features/groups/groups.page.js`, loaded via
`<script src="src/features/groups/groups.page.js"></script>` at the exact
same position. This alone cut `groups.html` from 3,515 lines to 459 — the
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
- `src/features/materials/materials.js`, `src/features/materials/materials-viewer.js`,
  `ads.js` (repo root) — already separate files, but each is a single
  undivided module (285–605 lines) and could be split by concern the same
  way `shared.js` was, once checked for coupling.

**Playbook for each**, refined from this pass:
1. Extract the inline `<script>` block verbatim into
   `src/features/<name>/<name>.page.js` first — zero-risk, immediate
   clutter reduction, always worth doing.
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
`src/lib/`, `src/components/`, or `src/features/` (anything `src/lib/index.js`
imports). `npm run dev:shared` watches for changes.
