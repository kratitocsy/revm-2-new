import { REVM2_CONFIG } from '../../lib/core/config.js';
/* ── SIGN OUT ─────────────────────────────────────────────── */
/* Call from any page after `const sb = supabase.createClient(...)` exists.
   Signs out of Supabase and sends the user back to login.html. Does NOT
   touch local revm2_* keys, so re-login on the same device still has
   the cached tracker until the next pull/sync. */
export async function signOutRevM2(){
  try{
    if(typeof sb !== 'undefined'){
      const {data:{session}} = await sb.auth.getSession();
      if(session){
        // Signing out was a zero-friction way around every layer of
        // enforcement this app has (blocked apps, blocked sites, the
        // desktop app's close-lock) - none of that cares whether you're
        // still signed in, it cares whether focus_lock_sessions has an
        // active row for you. "Sign out, do whatever, sign back in
        // later" bypassed all of it without even touching the
        // code-unlock/emergency-unlock flow that's supposed to be the
        // only way out of an active block. This closes that at the
        // root instead of chasing it through every enforcement layer
        // individually.
        try{
          const { data: activeSession } = await sb.from('focus_lock_sessions')
            .select('ends_at, unlimited, paused_until')
            .eq('user_id', session.user.id).eq('active', true).maybeSingle();
          // A session someone already paused via the legitimate
          // code-unlock flow doesn't re-block sign-out for its
          // remaining grace window - they've already gone through the
          // real escape valve; this isn't a second one on top of it.
          const genuinelyActive = activeSession && !(activeSession.paused_until && new Date(activeSession.paused_until) > new Date());
          if(genuinelyActive){
            const until = (!activeSession.unlimited && activeSession.ends_at)
              ? ' (ends ' + new Date(activeSession.ends_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) + ')'
              : '';
            alert('You have an active focus block right now'+until+' — signing out is disabled while it\'s running. Go to Blocks to end it early (code unlock / emergency unlock still work) if you need to stop.');
            return;
          }
        }catch(checkErr){
          // Couldn't verify either way - a network blip here shouldn't
          // itself become a reason to trap someone who has no active
          // block at all. Only a CONFIRMED active session blocks sign-out.
          console.error('RM2 active-session check failed, proceeding with sign-out:', checkErr);
        }
      }
      await sb.auth.signOut();
    }
  }catch(e){ /* ignore — still redirect below */ }
  window.location.href='login.html';
}

/* ── AUTH GUARD ───────────────────────────────────────────── */
/* Call at the top of any page that must be tied to a signed-in Google account.
   Redirects to login.html and returns null if there's no session. */
export async function requireAuth(){
  try{
    if(typeof sb === 'undefined') { window.location.href='login.html'; return null; }
    const {data:{session}} = await sb.auth.getSession();
    if(!session){ window.location.href='login.html'; return null; }
    startDesktopAuthSync(session);
    return session;
  }catch(e){ window.location.href='login.html'; return null; }
}

// Kicks off the desktop-sync side effects (pairing + native token push +
// keeping it fresh on refresh) for a known-good session. Idempotent via
// __rm2DesktopAuthSyncStarted so it's safe to call from more than one
// place - see the page-agnostic autostart block below, which is what
// actually makes this run on every page rather than only the ones that
// remember to call requireAuth().
export let __rm2DesktopAuthSyncStarted = false;
export function startDesktopAuthSync(session){
  if(typeof window.__TAURI__ === 'undefined' || !session) return; // no-op outside the desktop app
  autoConnectDesktop(session.user.id);
  syncNativeAuthToken(session);
  if(__rm2DesktopAuthSyncStarted) return; // listener already registered by an earlier call on this page
  __rm2DesktopAuthSyncStarted = true;
  // Keeps the desktop app's own copy of the access token current as
  // supabase-js refreshes it in the background, not just at page load -
  // see syncNativeAuthToken's own doc comment for why this matters.
  sb.auth.onAuthStateChange((_event, newSession)=>{ syncNativeAuthToken(newSession); });
}

/* ── DESKTOP NATIVE-AUTH AUTOSTART (page-agnostic) ─────────────────
   Runs the moment shared.js loads on ANY page - regardless of whether
   that page calls requireAuth() or does its own custom session check
   (a few, like store.html/revhead.html/admin.html/telegram.html,
   don't). native_poll.rs's Rust-side session poll is what actually
   keeps enforcement running independent of whichever page's JS is
   currently active, but it has nothing to query Supabase with until
   SOME page pushes it a token via sync_native_auth - and that used to
   only happen from inside requireAuth(). Concretely, this was the bug
   behind "the desktop app doesn't kill not-allowed apps unless I'm on
   the Blocks tab": sitting on any page that skipped requireAuth() left
   the native poll with no token to work with, so it sat idle no matter
   what page was open. Making every page carry this automatically -
   instead of trusting each one to remember to call requireAuth() -
   closes that gap for good, including for pages added later. `sb`
   itself is declared by a plain <script> tag placed right after
   shared.js's on every page, so it may not exist yet the instant this
   IIFE runs; poll briefly for it rather than assuming it's already
   there. Completely inert in a normal browser tab. */
(function(){
  if(typeof window.__TAURI__ === 'undefined') return; // desktop app only
  function start(){
    if(typeof sb === 'undefined'){ setTimeout(start, 150); return; }
    sb.auth.getSession().then(({data:{session}})=>{
      if(session) startDesktopAuthSync(session);
    }).catch(()=>{});
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

// Pushes the current Supabase access token to the desktop app's Rust
// process (see the `sync_native_auth` command / native_poll.rs). The
// desktop app's own enforcement otherwise depends entirely on THIS page's
// setInterval(loadActiveBlock / pollBlockStatusForDesktop, 5000) poll to
// learn when a schedule-driven block should start or end - and Chromium
// (WebView2 on Windows included) deliberately throttles or pauses that
// kind of timer once the window is treated as backgrounded, which can
// happen just from the monitor turning off, even though nothing else
// about the app or machine is actually asleep. Giving the Rust side its
// own token lets it check Supabase directly on a native timer instead,
// so enforcement keeps working through exactly that gap. Completely
// inert outside the desktop app (window.__TAURI__ only exists there) and
// safe to call redundantly - it only ever overwrites the cached token.
export function syncNativeAuthToken(session){
  if(typeof window.__TAURI__ === 'undefined' || !window.__TAURI__.core || !session) return;
  window.__TAURI__.core.invoke('sync_native_auth', {
    userId: session.user.id,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    supabaseUrl: REVM2_CONFIG.SUPABASE_URL,
    supabaseAnonKey: REVM2_CONFIG.SUPABASE_ANON,
  }).catch(e=>console.error('RM2 desktop invoke error (sync_native_auth):', e));
}

// Silently pairs this desktop app instance with the signed-in account, the
// same way autoConnectExtension() (in blocks.html) pairs the browser
// extension - fires once per login, no click needed. Completely inert in
// a normal browser tab; window.__TAURI__ only exists when this page is
// loaded inside the desktop app's window.
export async function autoConnectDesktop(userId){
  if(typeof window.__TAURI__ === 'undefined') return;
  try{
    const invoke = window.__TAURI__.core.invoke;
    const existing = await invoke('get_token').catch(()=>'');
    if(existing) return; // already paired on this device

    const raw = crypto.randomUUID()+crypto.randomUUID();
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const hash = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');

    const { error } = await sb.from('extension_sync_tokens').insert({
      token_hash: hash, user_id: userId, label: 'Desktop app'
    });
    if(error) return; // pairing must never break the page

    await invoke('save_token', { token: raw });
  }catch(e){ /* pairing must never break the page */ }
}

