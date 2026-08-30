/* ============================================================
   RevM² — src/lib/index.js
   Single entry point that assembles every module below and
   re-exposes them as globals, so this compiles down to a
   drop-in replacement for the old shared.js.

   DO NOT hand-edit shared.js at the repo root anymore — it is
   generated. Edit the module under src/lib/ instead, then run:
     npm run build:shared
   See docs/MODULARIZATION.md for the full picture.
   ============================================================ */

import * as config from './core/config.js';
import * as store from './core/store.js';
import * as format from './core/format.js';
import * as nav from './core/nav.js';
import * as auth from '../features/auth/auth.js';
import * as analytics from './core/analytics.js';
import * as trackerSync from '../features/tracker/tracker-sync.js';
import * as examSwitcher from './core/exam-switcher.js';

import * as typographyReveal from './ui/typography-reveal.js';
import * as starfield from './ui/starfield.js';
import * as sound from './ui/sound.js';
import * as logo from './ui/logo.js';
import * as loadingOverlay from './ui/loading-overlay.js';
import * as callRingtone from './ui/call-ringtone.js';
import * as incomingCallToast from './ui/incoming-call-toast.js';
import * as unreadBadges from './ui/unread-badges.js';
import * as mobileSidebar from './ui/mobile-sidebar.js';
import * as sidebarHover from './ui/sidebar-hover.js';
import * as animate from './ui/animate.js';

// Every page (and every inline onclick="" handler in every .html
// file) still expects these on `window`, exactly as the old
// shared.js provided them. Re-export everything, then mirror it.
export * from './core/config.js';
export * from './core/store.js';
export * from './core/format.js';
export * from './core/nav.js';
export * from '../features/auth/auth.js';
export * from './core/analytics.js';
export * from '../features/tracker/tracker-sync.js';
export * from './core/exam-switcher.js';
export * from './ui/typography-reveal.js';
export * from './ui/starfield.js';
export * from './ui/sound.js';
export * from './ui/logo.js';
export * from './ui/loading-overlay.js';
export * from './ui/call-ringtone.js';
export * from './ui/incoming-call-toast.js';
export * from './ui/unread-badges.js';
export * from './ui/mobile-sidebar.js';
export * from './ui/sidebar-hover.js';
export * from './ui/animate.js';

const modules = [
  config, store, format, nav, auth, analytics, trackerSync, examSwitcher,
  typographyReveal, starfield, sound, logo, loadingOverlay, callRingtone,
  incomingCallToast, unreadBadges, mobileSidebar, sidebarHover, animate,
];

for (const mod of modules) {
  for (const [key, value] of Object.entries(mod)) {
    if (key.startsWith('_')) continue; // module-private (e.g. _syncTimer)
    window[key] = value;
  }
}
