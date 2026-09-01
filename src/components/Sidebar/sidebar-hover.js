import { closeMobileSidebar, openMobileSidebar } from './mobile-sidebar.js';
/* ── DESKTOP HOVER-REVEAL SIDEBAR ─────────────────────────────
   On desktop the sidebar isn't permanently pinned open anymore —
   it starts hidden off-screen (see style.css) and slides in as an
   overlay while the cursor is resting on a thin trigger strip
   glued to the left edge, or on the sidebar itself once it's out;
   it slides back away once the cursor leaves both. Mobile is
   completely untouched by this — the hamburger button is hidden
   on desktop by CSS, so this only ever matters there, and mobile
   still opens/closes exclusively via openMobileSidebar()/
   closeMobileSidebar() above. */
export function initSidebarHoverReveal(){
  const sidebar = document.querySelector('.sidebar');
  if(!sidebar) return; // page has no app sidebar at all (e.g. login, admin)
  if(document.getElementById('sidebarHoverZone')) return; // idempotent

  const zone = document.createElement('div');
  zone.id = 'sidebarHoverZone';
  zone.className = 'sidebar-hover-zone';
  document.body.appendChild(zone);

  let closeTimer = null;
  function reveal(){
    clearTimeout(closeTimer);
    sidebar.classList.add('hover-open');
  }
  function scheduleHide(){
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => sidebar.classList.remove('hover-open'), 180);
  }
  zone.addEventListener('mouseenter', reveal);
  sidebar.addEventListener('mouseenter', reveal);
  zone.addEventListener('mouseleave', scheduleHide);
  sidebar.addEventListener('mouseleave', scheduleHide);
}
document.addEventListener('DOMContentLoaded', initSidebarHoverReveal);

/* ============================================================
   MOTION HELPERS — loaded on every page (shared.js).
   Small, dependency-free utilities for count-up numbers and
   staggered entrance animation on dynamically rendered lists.
   ============================================================ */
