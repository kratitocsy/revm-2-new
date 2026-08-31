/* ============================================================
   RevM² — src/lib/utils.js

   Grab-bag of genuinely generic, framework-agnostic helpers with
   no DOM/Supabase-shape dependency beyond what's documented inline.
   This is a straight merge of what used to be three separate
   src/lib/core/ files (format.js, nav.js, analytics.js) — merged
   only because they're all small and equally "just a utility",
   not because they're related to each other. If any one of these
   grows a real cluster of its own helpers again, split it back out.
   ============================================================ */

/* ── EBBINGHAUS INTERVALS ────────────────────────────────── */
/* The spaced-repetition schedule every topic gets, used by the
   Recall Curve / tracker / review-queue logic on home.html,
   tracker.html, and timer.html. Not Supabase-specific (it's app
   domain config), so it lives here rather than in supabase.js. */
export const INTERVALS = [
  { key:'r0', label:'5m',   days:0      },
  { key:'r1', label:'12h',  days:0.5    },
  { key:'r2', label:'+1D',  days:1      },
  { key:'r3', label:'+2D',  days:2      },
  { key:'r4', label:'+4D',  days:4      },
  { key:'r5', label:'+7D',  days:7      },
  { key:'r6', label:'+15D', days:15     },
  { key:'r7', label:'+30D', days:30     }
];

/* ── DATE HELPERS ────────────────────────────────────────── */
export const TODAY = (() => { const d=new Date(); d.setHours(0,0,0,0); return d; })();
export const TODAY_STR = TODAY.toISOString().split('T')[0];

export function fmtDateShort(d) {
  return new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'});
}
export function fmtDateFull(d) {
  return new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
}
export function fmtTime(secs) {
  const h=Math.floor(secs/3600), m=Math.floor((secs%3600)/60);
  return h>0?`${h}h ${m}m`:`${m}m`;
}
export function escHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* escAttr: use this instead of escHtml whenever a value is being embedded
   inside a single-quoted JS string literal in an inline handler, e.g.
   onclick="doThing('${escAttr(name)}')". escHtml alone is NOT safe there --
   the browser HTML-decodes attribute values BEFORE handing them to the JS
   parser, so an HTML-encoded quote (&#39;) just turns back into a real '
   and still breaks out of the string. escAttr backslash-escapes the
   characters that matter to the JS parser first (so the quote survives
   HTML decoding as an inert escaped char), then HTML-escapes the result
   for the surrounding double-quoted attribute. */
export function escAttr(s){
  s = String(s==null ? '' : s)
    .replace(/\\/g,'\\\\')
    .replace(/'/g,"\\'")
    .replace(/\n/g,'\\n')
    .replace(/\r/g,'\\r');
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

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

/* ── ANALYTICS / EVENT LOGGING ───────────────────────────── */
/* Fire-and-forget. Call after `const sb = supabase.createClient(...)` exists on the page.
   Usage: logEvent('feature_used', 'timer'); logEvent('review_completed'); */
export async function logEvent(eventType, feature=null, meta=null){
  try{
    if(typeof sb === 'undefined') return;
    const {data:{session}} = await sb.auth.getSession();
    if(!session) return;
    await sb.from('user_events').insert({
      user_id: session.user.id, event_type: eventType, feature, meta
    });
  }catch(e){ /* analytics must never break the app */ }
}
