/* ── PAGE NAVIGATION ──────────────────────────────────────── */
/* Every sidebar nav-item calls onclick="go('somepage.html')". This was
   only ever defined locally inside tracker.html and explainer.html, so
   on every OTHER page (groups, partners, store, calculator, chat, admin,
   index, onboarding, predictor, revhead, telegram) clicking a sidebar
   item threw "go is not defined" and silently did nothing — the mobile
   drawer would still auto-close (separate listener below) but the app
   never navigated, making the whole nav bar look dead. Defining it once
   here, shared on every page, fixes navigation everywhere. */
export function go(url){ window.location.href = url; }
// Sidebar "Invite friends" entry point, present on every logged-in page.
// On groups.html itself, open the quick-invite modal in place instead of
// a full page reload; everywhere else, navigate there with the trigger
// param so groups.html's init() opens it automatically after loading.
export function goInvite(){
  if(location.pathname.endsWith('groups.html') && typeof openQuickInviteModal === 'function'){
    openQuickInviteModal();
  } else {
    window.location.href = 'groups.html?quickinvite=1';
  }
}

