# RevM² — THE LIVE STUDY NETWORK

RevM² is a full-stack live study network built for Indian competitive exam aspirants (JEE, NEET, CAT, UPSC, GATE) — Ebbinghaus spaced-repetition tracking, live study groups with a video/audio RevMGrid, a coin economy, bounty study challenges, swipe-style partner matching, a creator economy via the RevHead program, and a cross-platform **Focus Lock** distraction-blocking system (browser extension + Windows desktop app), all running on free-tier infrastructure.

Built solo, vanilla HTML/CSS/JS on the web, no framework, no build step.

## Features

**Tracker**
- Ebbinghaus spaced-repetition scheduler with a Memory Strength visualization (exponential decay model)
- Study timer synced across devices via a shared `revm2_active_session` state
- Telegram bot integration for revision reminders

**Focus Lock — distraction blocking**
- Manual and scheduled focus blocks (`blocks.html`) with recurring weekly schedules, per-slot subjects, sleep-hour slots, and one-off schedule overrides
- Reusable blocking presets (blacklist specific sites, or allow-only a whitelist)
- YouTube-aware rules — block YouTube generally while allowing specific whitelisted channels through
- "Pause for a Cause" unlock gate: every session (timed or unlimited) requires an explicit gate click before either unlock path appears — a free 150-character typed-code pause (capped at once per session, enforced server-side) or a paid emergency unlock
- Companion Chrome/Edge/Brave/Opera/Vivaldi browser extension enforces the block at the network level via `declarative_net_request`, with an optional adult-content blocklist, and stays synced with the web session in real time
- **Windows desktop app** (Tauri): detects whether the browser extension is installed and enabled per-browser, and closes non-compliant browsers while a focus session is active — enforced through dedicated guard modules (`browser_guard`, `app_guard`, `taskmgr_guard` + `taskmgr_backstop`, `gate_guard`) plus a background `heartbeat`/`native_poll` loop and a `session_bridge` that syncs lock state with the web tracker/blocks pages

**RevMGrid — live study rooms**
- WebRTC group video/voice (mesh for small groups, Agora SFU with Tencent RTC fallback beyond the 4-person mesh threshold)
- Auto-switching UI: a plain roster grid when no one's on camera/voice, a Zoom-style spotlight + paginated video grid the moment someone joins the call
- Active-speaker spotlight (via Web Audio API `AnalyserNode`), per-tile pin (keep someone always visible) and hide (local-only) controls
- Raise hand, mute/deafen, real-time presence, DND quiet-study mode
- Realtime group text chat alongside the video grid

**Group Materials**
- Group-specific sidebar (Materials, Analytics, Members) once a member opens a group
- Upload rights default to group admins, individually grantable to specific members; delete stays uploader-or-admin
- PDFs are compressed client-side on upload (canvas + pdf-lib re-encoding) before hitting per-file/per-group size caps
- View-only, watermarked (viewer name + timestamp) canvas-rendered viewer (pdf.js) with no raw download link, disabled right-click/print/select, and blur-on-tab-blur — a deterrent layer on web, backed by Backblaze B2 storage proxied through a Cloudflare Worker that verifies short-lived signed view tokens

**Coin economy (M²)**
- RLS-protected wallets, M² Store for cosmetics/avatars
- Challenge/bounty system between members (with fraud and wagering-law safeguards on purchased vs. earned coins)
- Group leaderboards

**Study Partners**
- Tinder-style matching, opt-in and gender-filtered, mutual unlock required with Superlike and an intro/ice-breaker message
- Dedicated "Study Buddies" page separating 1:1 friend/DM management from the partner-matching flow
- 1:1 DM chat and video calls once matched

**Predictor**
- Dual JEE/NEET rank and college predictor with state-quota support, built on a real NEET AIQ dataset
- Marks calculator

**RevHead program**
- Referral/community growth program with a 12% revenue share, UPI payout requests, and an admin approval queue

**Admin**
- Dashboards for group moderation, RevHead approvals, and platform analytics

## Tech Stack

- **Frontend (web):** Vanilla HTML/CSS/JS (no framework) — `index.html`, `tracker.html`, `blocks.html`, `groups.html`, `partners.html`, `store.html`, `predictor.html`, `revhead.html`, `chat.html`, `admin.html`, and friends
- **Browser extension:** Manifest V3, `declarative_net_request` for site blocking, syncs with the web session
- **Desktop companion (Windows):** [Tauri](https://tauri.app) (Rust + webview) — loads the production site directly in-app, scoped via Tauri capability permissions to that domain; auto-pairs with a logged-in session via a sync token, no manual copy-paste; built via GitHub Actions on a Windows runner (`.github/workflows/build-desktop.yml`)
- **Backend:** [Supabase](https://supabase.com) — Postgres, Auth, Row-Level Security, Realtime (presence + `postgres_changes`), Edge Functions (`schedule-tick`, `session-pause`, `yt-resolve-channel`)
- **Video/Voice:** WebRTC (mesh) with STUN + Metered.ca TURN fallback for restrictive networks; Agora SFU (Tencent RTC fallback) for larger group calls
- **Materials storage:** Backblaze B2 (private bucket) behind a Cloudflare Worker proxy that verifies signed, short-lived view tokens
- **Automation:** [n8n](https://n8n.io) for reminders and scheduled jobs
- **Hosting:** [Vercel](https://vercel.com)
- **PWA:** `manifest.json` + `sw.js` for installability and offline shell

Everything runs on free tiers by design — no dedicated media server, no paid database plan.

## Project Structure

```
.
├── index.html                 Landing page
├── login.html                 Auth
├── onboarding.html            First-run setup
├── explainer.html             Welcome/how-it-works
├── tracker.html               Spaced-repetition tracker + study timer
├── blocks.html                Focus Lock: manual/scheduled blocks, presets, unlock flow
├── groups.html                Study groups: RevMGrid (video/voice), group chat, Materials
├── partners.html               Study partner matching + Study Buddies
├── chat.html                   1:1 DM chat + calls
├── store.html                  M² Store (coin economy, avatars)
├── predictor.html              JEE/NEET rank & college predictor
├── revhead.html                 RevHead referral/revenue-share program
├── calculator.html             Marks calculator
├── telegram.html                Telegram reminder linking
├── admin.html                   Admin dashboards
├── privacy.html                  Privacy policy
├── floating-timer.js            Persistent study-timer widget (shared across pages)
├── materials.js / materials-viewer.js   Group Materials upload + watermarked viewer
├── shared.js                    Shared utilities (session sync, desktop/extension auto-connect)
├── style.css                    Global styles
├── manifest.json / sw.js         PWA config
├── desktop/                      Tauri Windows companion app (monorepo subfolder)
│   ├── src/                       Frontend (webview) — loads the production site
│   └── src-tauri/                  Rust backend — guard modules, heartbeat, session bridge
├── supabase/functions/            Edge Functions (schedule-tick, session-pause, yt-resolve-channel)
├── supabase_migrations/           Numbered SQL migrations (run in order in Supabase SQL Editor)
├── docs/                          Design/research notes (e.g. Focus Lock locking research)
└── .github/workflows/             CI — builds the Windows desktop installer
```

## Setup

1. Create a [Supabase](https://supabase.com) project.
2. Run every file in `supabase_migrations/` **in numeric order** via the Supabase SQL Editor. Each migration is idempotent (`if not exists` / `or replace`) and safe to re-run.
3. Deploy the Edge Functions in `supabase/functions/` (`schedule-tick`, `session-pause`, `yt-resolve-channel`).
4. Fill in your Supabase URL/anon key and any third-party keys (Metered.ca TURN credentials, Agora/Tencent RTC keys, Telegram bot token, Backblaze B2 + Cloudflare Worker config, Google Ad Manager, etc.) wherever they're referenced in `shared.js` / the relevant page's `<script>` block.
5. Deploy the static files to [Vercel](https://vercel.com) (or serve locally — no build step required).
6. (Optional) Load the browser extension unpacked for local Focus Lock testing.
7. (Optional) Build the desktop companion via `cd desktop && npm install && npm run tauri build` (or push to `main` to trigger the GitHub Actions Windows build).
8. (Optional) Wire up n8n for scheduled reminders/automation.

## Status

Actively developing to optimize for mobile usage, and building out the Group Materials feature and Focus Lock desktop enforcement (browser-kill reliability, install-time persistence/uninstall-guard).

Copyright (c) 2026 RevM² LLP. All rights reserved.

This repository and its contents (source code, assets, documentation, and
database schema/migrations) are made publicly viewable for portfolio,
reference, and demonstration purposes only.

No permission is granted to any person except the Team of RevM² LLP to copy, modify, merge, publish,
distribute, sublicense, deploy, or sell copies of this software, in whole
or in part, without prior written permission from the copyright holder.

Viewing and forking for personal, non-distributed, educational reference
is permitted. Any other use — including running a derivative product,
redistributing the code, or incorporating it into another project —
requires explicit written permission.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
THE AUTHOR BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
