/* ============================================================
   RevM² — src/components/Header/Header.js

   Not to be confused with the app Sidebar. This is the top nav
   bar used on the public/marketing pages only — landing.html,
   film.html, product-tour.html — which are logged-out pages with
   no sidebar at all. product-tour.html has the fullest version
   (`#siteHeader`); landing.html and film.html use a lighter one.

   These three were NOT byte-identical the way the sidebar was —
   each page has different nav links for its own content — so
   this doesn't collapse them into one static template. Instead
   it gives them a shared, parameterized shape so future marketing
   pages don't hand-roll a fourth variant.

   Usage:
     import { renderHeader } from '../components/Header/Header.js';
     document.getElementById('headerSlot').outerHTML = renderHeader({
       links: [{ href: '#features', label: 'Features' }, { href: '#pricing', label: 'Pricing' }],
       ctaHref: 'login.html',
       ctaLabel: 'Sign in',
     });

   Existing pages are NOT auto-migrated yet — see docs/MODULARIZATION.md.
   ============================================================ */

export function renderHeader({ links = [], ctaHref = 'login.html', ctaLabel = 'Sign in' } = {}){
  const navLinks = links.map(l => `<a href="${l.href}">${l.label}</a>`).join('\n      ');
  return `<header id="siteHeader">
  <div class="wrap">
    <nav>
      <a href="#top" class="logo">
        <img src="wynko-logo.png" alt="WYNKO" height="28">
      </a>
      <div class="header-links">
        ${navLinks}
      </div>
      <a href="${ctaHref}" class="btn btn-gold btn-sm">${ctaLabel}</a>
    </nav>
  </div>
</header>`;
}
