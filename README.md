# RevM² — THE  LIVE STUDY NETWORK

RevM² is a full-stack Live Study Network  built for Exam aspirants- Ebbinghaus  spaced-repetition tracking, live study groups  with live grid with video and audio rooms , a coin economy,  Bounty study challenges , swipale partner matching and a creator economy with revhead program  all running on free-tier infrastructure.

Built solo, vanilla HTML/CSS/JS, no framework, no build step.

## Features

**Tracker**
- Ebbinghaus spaced-repetition scheduler with a Memory Strength visualization (exponential decay model)
- Study timer synced across devices via a shared `revm2_active_session` state
- Telegram bot integration for revision reminders

**RevMGrid — live study rooms**
- WebRTC group video/voice (mesh for small groups, SFU-ready stub for larger ones)
- Auto-switching UI: a plain roster grid when no one's on camera/voice, a Zoom-style spotlight + paginated video grid the moment someone joins the call
- Active-speaker spotlight, per-tile pin (keep someone always visible) and hide (local-only) controls
- Raise hand, mute/deafen, real-time presence
- Realtime group text chat alongside the video grid

**Coin economy (M²)**
- RLS-protected wallets, M² Store for cosmetics/avatars
- Challenge/bounty system between members (with fraud and wagering-law safeguards on purchased vs. earned coins)

**Study Partners**
- Tinder-style matching, opt-in and gender-filtered, mutual unlock required
- 1:1 DM chat and video calls once matched

**Predictor**
- Dual JEE/NEET rank and college predictor with state-quota support, built on a real NEET AIQ dataset

**RevHead program**
- Referral/community growth program with a 12% revenue share, UPI payout requests, and an admin approval queue

**Admin**
- Dashboards for group moderation, RevHead approvals, and platform analytics

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS (no framework) — `index.html`, `tracker.html`, `groups.html`, `partners.html`, `store.html`, `predictor.html`, `revhead.html`, `chat.html`, `admin.html`, and friends
- **Backend:** [Supabase](https://supabase.com) — Postgres, Auth, Row-Level Security, Realtime (presence + `postgres_changes`), Edge Functions
- **Video/Voice:** WebRTC (mesh), STUN + Metered.ca TURN fallback for restrictive networks
- **Automation:** [n8n](https://n8n.io) for reminders and scheduled jobs
- **Hosting:** [Vercel](https://vercel.com)
- **PWA:** `manifest.json` + `sw.js` for installability and offline shell

Everything runs on free tiers by design — no dedicated media server, no paid database plan.

## Project Structure

```
.
├── index.html               Landing page
├── login.html                Auth
├── onboarding.html           First-run setup
├── explainer.html            Welcome/how-it-works
├── tracker.html              Spaced-repetition tracker + study timer
├── groups.html                Study groups: RevMGrid (video/voice) + group chat
├── partners.html              Study partner matching
├── chat.html                  1:1 DM chat + calls
├── store.html                 M² Store (coin economy, avatars)
├── predictor.html             JEE/NEET rank & college predictor
├── revhead.html                RevHead referral/revenue-share program
├── calculator.html            Marks calculator
├── telegram.html               Telegram reminder linking
├── admin.html                  Admin dashboards
├── privacy.html                 Privacy policy
├── floating-timer.js           Persistent study-timer widget (shared across pages)
├── shared.js                   Shared utilities
├── style.css                   Global styles
├── manifest.json / sw.js        PWA config
└── supabase_migrations/         Numbered SQL migrations (run in order in Supabase SQL Editor)
```

## Setup

1. Create a [Supabase](https://supabase.com) project.
2. Run every file in `supabase_migrations/` **in numeric order** via the Supabase SQL Editor. Each migration is idempotent (`if not exists` / `or replace`) and safe to re-run.
3. Fill in your Supabase URL/anon key and any third-party keys (Metered.ca TURN credentials, Telegram bot token, Google Ad Manager, etc.) wherever they're referenced in `shared.js` / the relevant page's `<script>` block.
4. Deploy the static files to [Vercel](https://vercel.com) (or serve locally — no build step required).
5. (Optional) Wire up n8n for scheduled reminders/automation.

## Status

Actively Developing to optimize it for mobile usage.

 Copyright (c) 2026 RevM² LLP  All rights reserved.

This repository and its contents (source code, assets, documentation, and
database schema/migrations) are made publicly viewable for portfolio,
reference, and demonstration purposes only.

No permission is granted to any person except Team  of RevM² LLP  to copy, modify, merge, publish,
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

