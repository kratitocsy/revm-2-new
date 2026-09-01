/* ============================================================
   RevM² — scripts/build-sidebars.js

   Stamps the shared Sidebar component (src/components/Sidebar/Sidebar.js)
   into every page that uses the standard sidebar. Same philosophy
   as vite.shared.config.js building shared.js: the source of truth
   is one small module, the served .html files stay plain static
   HTML (no client-side injection, no flash-of-missing-sidebar) —
   they're just generated instead of hand-duplicated.

   DO NOT hand-edit the sidebar block inside these .html files
   anymore. Edit src/components/Sidebar/Sidebar.js, then run:
     npm run build:sidebars
   and commit both.

   pledge.html deliberately has its OWN different sidebar (different
   nav items, not a duplicate of this one) — it is not in this list
   and this script never touches it. See docs/MODULARIZATION.md.
   ============================================================ */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { renderSidebar } from '../src/components/Sidebar/Sidebar.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Per-page config. trackText/examText default to '—' (page scripts
// overwrite these at runtime once the user's profile loads) except
// where the original file had a hardcoded placeholder value.
const PAGES = [
  { file: 'home.html',     active: 'home.html',     showSignOut: true,  trackText: 'JEE Main 2026', examText: '128 days remaining' },
  { file: 'tracker.html',  active: 'tracker.html',  showSignOut: true },
  { file: 'timer.html',    active: 'timer.html',    showSignOut: true },
  { file: 'battle.html',   active: 'battle.html',   showSignOut: true },
  { file: 'groups.html',   active: 'groups.html',   showFooter: false },
  { file: 'chat.html',     active: 'chat.html',     showSignOut: true },
  { file: 'partners.html', active: 'partners.html', showFooter: false },
  { file: 'store.html',    active: 'store.html',    showFooter: false },
  { file: 'revhead.html',  active: 'revhead.html',  showSignOut: true },
  { file: 'blocks.html',   active: 'blocks.html',   showSignOut: false }, // blocks.html's sidebar has no sign-out button
];

let changed = 0;

for (const page of PAGES) {
  const path = resolve(ROOT, page.file);
  const html = readFileSync(path, 'utf8');
  const lines = html.split('\n');

  const startIdx = lines.findIndex(l => l.includes('<aside class="sidebar">'));
  if (startIdx === -1) {
    console.error(`[build-sidebars] ${page.file}: no <aside class="sidebar"> found, skipping`);
    continue;
  }
  let endIdx = -1;
  for (let i = startIdx; i < lines.length; i++) {
    if (lines[i].includes('sidebar-backdrop')) { endIdx = i; break; }
  }
  if (endIdx === -1) {
    console.error(`[build-sidebars] ${page.file}: no sidebar-backdrop found after aside, skipping`);
    continue;
  }

  const rendered = renderSidebar(page);
  const newLines = [
    ...lines.slice(0, startIdx),
    rendered,
    ...lines.slice(endIdx + 1),
  ];
  const newHtml = newLines.join('\n');

  if (newHtml !== html) {
    writeFileSync(path, newHtml);
    console.log(`[build-sidebars] ${page.file}: updated`);
    changed++;
  } else {
    console.log(`[build-sidebars] ${page.file}: unchanged`);
  }
}

console.log(`[build-sidebars] done — ${changed} file(s) changed`);
