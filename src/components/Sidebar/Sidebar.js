/* ============================================================
   RevM² — src/components/Sidebar/Sidebar.js

   The main app sidebar (logo, nav, track/exam footer, sign-out)
   was duplicated byte-for-byte across every logged-in page —
   home.html, tracker.html, blocks.html, timer.html, groups.html,
   battle.html, chat.html, partners.html, pledge.html, store.html,
   revhead.html (11 pages). The only things that ever varied were:
     - which nav item has the `active` class
     - whether the footer includes a sign-out button
     - the initial track/exam text (always overwritten at runtime
       by whatever page-specific script reads the user's profile)

   This component is the single source of truth for that markup.
   Usage (unchanged pages keep working — nothing auto-runs):

     import { renderSidebar } from '../components/Sidebar/Sidebar.js';
     document.getElementById('sidebarSlot').outerHTML =
       renderSidebar({ active: 'home.html' });

   See docs/MODULARIZATION.md → "components/" for the page-by-page
   migration status (which pages still have the old inline markup
   vs. call this component).
   ============================================================ */

export const NAV_ITEMS = [
  { section: 'Modules' },
  { page: 'home.html', label: 'Home',
    icon: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
  { page: 'timer.html', label: 'Focus Lock',
    icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
  { page: 'tracker.html', label: 'Recall Curve',
    icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>' },
  { page: 'groups.html', label: 'Study Rooms',
    icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
  { page: 'blocks.html', label: '3D Library',
    icon: '<path d="M2 20h20M5 20V10l7-6 7 6v10"/><path d="M9 20v-4h6v4"/>' },
  { page: 'store.html', label: 'Materials',
    icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>' },
  { section: 'Social' },
  { page: 'partners.html', label: 'Partners',
    icon: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>' },
  { page: 'revhead.html', label: 'Community',
    icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
  { page: 'chat.html', label: 'Group Chat',
    icon: '<path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z"/><path d="M10 19a2 2 0 0 0 4 0"/>' },
];

const ICON_SVG = (paths) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

function renderNav(active){
  return NAV_ITEMS.map(item => {
    if (item.section) return `<div class="nav-section">${item.section}</div>`;
    const isActive = item.page === active ? ' active' : '';
    return `<div class="nav-item${isActive}" onclick="go('${item.page}')"><span class="nav-icon">${ICON_SVG(item.icon)}</span>${item.label}</div>`;
  }).join('\n  ');
}

const SIGN_OUT_BTN = `<button class="sidebar-logout" onclick="signOutRevM2()" title="Sign out"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:0.3rem;"><path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4"/><path d="M15 8l4 4-4 4M19 12H9"/></svg>Sign out</button>`;

/**
 * Render the sidebar markup as an HTML string.
 * @param {Object} opts
 * @param {string} opts.active - which page's nav item gets the `active` class (e.g. 'home.html')
 * @param {boolean} [opts.showFooter=true] - groups.html, partners.html, and store.html have NO footer
 *   at all (no track/exam/sign-out) — pass false for those
 * @param {boolean} [opts.showSignOut=true] - blocks.html has a footer but omits the sign-out button
 * @param {string} [opts.trackText='—'] - initial #sTrack text (page scripts overwrite this after auth loads)
 * @param {string} [opts.examText='—'] - initial #sExam text
 */
export function renderSidebar({ active, showFooter = true, showSignOut = true, trackText = '—', examText = '—' } = {}){
  const footer = showFooter ? `
    <div class="sidebar-footer">
      <div class="sidebar-track" id="sTrack">${trackText}</div>
      <div class="sidebar-exam" id="sExam">${examText}</div>
      ${showSignOut ? SIGN_OUT_BTN : ''}
    </div>` : '';
  return `<aside class="sidebar">
    <a class="sidebar-logo" href="index.html"><img src="wynko-logo.png" alt="WYNKO" class="sidebar-logo-img"></a>
    <nav class="sidebar-nav">
  ${renderNav(active)}
</nav>${footer}
  </aside>

  <!-- MOBILE NAV BACKDROP -->
  <div class="sidebar-backdrop" id="sidebarBackdrop" onclick="closeMobileSidebar()"></div>`;
}

/**
 * Mount the sidebar into the DOM, replacing an element (typically a
 * `<div id="sidebarSlot"></div>` placeholder left where the old
 * `<aside class="sidebar">...</aside>` + backdrop block used to be).
 */
export function mountSidebar(slotId, opts){
  const slot = document.getElementById(slotId);
  if (!slot) return;
  slot.outerHTML = renderSidebar(opts);
}
