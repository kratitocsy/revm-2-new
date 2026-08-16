/* ── MOBILE SIDEBAR (hamburger drawer) ──────────────────────
   Used on pages with the .sidebar app-shell (tracker, groups,
   store, calculator, predictor). Sidebar itself stays in the
   DOM at all times — this just toggles a class + backdrop so
   desktop layout/CSS is completely unaffected. ──────────── */
export function openMobileSidebar(){
  const sb = document.querySelector('.sidebar');
  const bd = document.getElementById('sidebarBackdrop');
  if(sb) sb.classList.add('mobile-open');
  if(bd) bd.classList.add('active');
  document.body.style.overflow = 'hidden';
}
export function closeMobileSidebar(){
  const sb = document.querySelector('.sidebar');
  const bd = document.getElementById('sidebarBackdrop');
  if(sb) sb.classList.remove('mobile-open');
  if(bd) bd.classList.remove('active');
  document.body.style.overflow = '';
}
// Auto-close the drawer after tapping any nav item (mobile only)
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.sidebar .nav-item').forEach(el => {
    el.addEventListener('click', () => {
      if(window.innerWidth <= 768) closeMobileSidebar();
    });
  });
  // Keep drawer state correct if the device is rotated / resized past the breakpoint
  window.addEventListener('resize', () => {
    if(window.innerWidth > 768) closeMobileSidebar();
    else document.querySelector('.sidebar')?.classList.remove('hover-open');
  });
});

