/* ============================================================
   RevM² — src/lib/index.js
   Single entry point that assembles every module below and
   re-exposes them as globals, so this compiles down to a
   drop-in replacement for the old shared.js.

   DO NOT hand-edit shared.js at the repo root anymore — it is
   generated. Edit the module under src/ instead, then run:
     npm run build:shared
   See docs/MODULARIZATION.md for the full picture.

   NOTE: Header/Header.js, Sidebar/Sidebar.js, Modal/Modal.js and
   Button/Button.js are deliberately NOT imported here. They were
   not wired into shared.js before this reorg either (see
   docs/MODULARIZATION.md — "not yet wired into any live page") and
   this pass is a structural move, not a behavior change. Sidebar.js
   is still consumed separately, at build time, by
   scripts/build-sidebars.js (a Node script, not part of the browser
   bundle). Adding the other three to this barrel is a real follow-up
   task, not a rename.
   ============================================================ */

import * as supabaseConfig from './supabase.js';
import * as storage from './storage.js';
import * as utils from './utils.js';
import * as auth from '../features/auth/auth.js';
import * as trackerSync from '../features/tracker/tracker-sync.js';

import * as mobileSidebar from '../components/Sidebar/mobile-sidebar.js';
import * as sidebarHover from '../components/Sidebar/sidebar-hover.js';
import * as examSwitcher from '../components/Sidebar/exam-switcher.js';
import * as typographyReveal from '../components/TypographyReveal/TypographyReveal.js';
import * as starfield from '../components/Starfield/Starfield.js';
import * as soundToggle from '../components/SoundToggle/SoundToggle.js';
import * as logo from '../components/Logo/Logo.js';
import * as loadingOverlay from '../components/LoadingOverlay/LoadingOverlay.js';
import * as callRingtone from '../components/CallRingtone/CallRingtone.js';
import * as incomingCallToast from '../components/IncomingCallToast/IncomingCallToast.js';
import * as unreadBadges from '../components/UnreadBadges/UnreadBadges.js';
import * as animateNumber from '../components/AnimateNumber/AnimateNumber.js';

// Every page (and every inline onclick="" handler in every .html
// file) still expects these on `window`, exactly as the old
// shared.js provided them. Re-export everything, then mirror it.
export * from './supabase.js';
export * from './storage.js';
export * from './utils.js';
export * from '../features/auth/auth.js';
export * from '../features/tracker/tracker-sync.js';
export * from '../components/Sidebar/mobile-sidebar.js';
export * from '../components/Sidebar/sidebar-hover.js';
export * from '../components/Sidebar/exam-switcher.js';
export * from '../components/TypographyReveal/TypographyReveal.js';
export * from '../components/Starfield/Starfield.js';
export * from '../components/SoundToggle/SoundToggle.js';
export * from '../components/Logo/Logo.js';
export * from '../components/LoadingOverlay/LoadingOverlay.js';
export * from '../components/CallRingtone/CallRingtone.js';
export * from '../components/IncomingCallToast/IncomingCallToast.js';
export * from '../components/UnreadBadges/UnreadBadges.js';
export * from '../components/AnimateNumber/AnimateNumber.js';

const modules = [
  supabaseConfig, storage, utils, auth, trackerSync,
  mobileSidebar, sidebarHover, examSwitcher,
  typographyReveal, starfield, soundToggle, logo, loadingOverlay,
  callRingtone, incomingCallToast, unreadBadges, animateNumber,
];

for (const mod of modules) {
  for (const [key, value] of Object.entries(mod)) {
    if (key.startsWith('_')) continue; // module-private (e.g. _syncTimer)
    window[key] = value;
  }
}
