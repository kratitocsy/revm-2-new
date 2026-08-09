/* ============================================================
   RevM² — shared.js
   Animated logo component + shared constants + utilities
   Load BEFORE supabase on every page.
   ============================================================ */

/* ── SUPABASE CONFIG ─────────────────────────────────────── */
const REVM2_CONFIG = {
  SUPABASE_URL:  'https://dhzjtjekbvxxsauzhadl.supabase.co',
  SUPABASE_ANON: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoemp0amVrYnZ4eHNhdXpoYWRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNjQ2NjUsImV4cCI6MjA5Nzk0MDY2NX0.2Uo36DtE7NpwW5wxOEwnmWjbXhHWXV-wf6qc7kXDtYE',
  /* ── Google Drive picker (materials import) ──────────────────────
   * Needed only for the "Import from Drive" button on the Materials
   * panel. Get these from a Google Cloud Console project:
   *   1. APIs & Services → Library → enable "Google Picker API" and
   *      "Google Drive API".
   *   2. Credentials → Create API key → GOOGLE_API_KEY below.
   *   3. Credentials → Create OAuth client ID (type: Web application),
   *      add your app's origin(s) under "Authorized JavaScript origins"
   *      → GOOGLE_CLIENT_ID below.
   * Leave both empty to hide the Drive-import button entirely. */
  GOOGLE_API_KEY:   '',
  GOOGLE_CLIENT_ID: '',
};

/* ── EBBINGHAUS INTERVALS ────────────────────────────────── */
const INTERVALS = [
  { key:'r0', label:'5m',   days:0      },
  { key:'r1', label:'12h',  days:0.5    },
  { key:'r2', label:'+1D',  days:1      },
  { key:'r3', label:'+2D',  days:2      },
  { key:'r4', label:'+4D',  days:4      },
  { key:'r5', label:'+7D',  days:7      },
  { key:'r6', label:'+15D', days:15     },
  { key:'r7', label:'+30D', days:30     }
];

/* ── LOCAL STORAGE HELPERS ───────────────────────────────── */
const Store = {
  get: (k, fallback=null) => { try { const v=localStorage.getItem(k); return v?JSON.parse(v):fallback; } catch(e){ return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k,JSON.stringify(v)); } catch(e){} },
  del: (k) => { try { localStorage.removeItem(k); } catch(e){} }
};

/* ── DATE HELPERS ────────────────────────────────────────── */
const TODAY = (() => { const d=new Date(); d.setHours(0,0,0,0); return d; })();
const TODAY_STR = TODAY.toISOString().split('T')[0];

function fmtDateShort(d) {
  return new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'});
}
function fmtDateFull(d) {
  return new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
}
function fmtTime(secs) {
  const h=Math.floor(secs/3600), m=Math.floor((secs%3600)/60);
  return h>0?`${h}h ${m}m`:`${m}m`;
}
function escHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* escAttr: use this instead of escHtml whenever a value is being embedded
   inside a single-quoted JS string literal in an inline handler, e.g.
   onclick="doThing('${escAttr(name)}')". escHtml alone is NOT safe there --
   the browser HTML-decodes attribute values BEFORE handing them to the JS
   parser, so an HTML-encoded quote (&#39;) just turns back into a real '
   and still breaks out of the string. escAttr backslash-escapes the
   characters that matter to the JS parser first (so the quote survives
   HTML decoding as an inert escaped char), then HTML-escapes the result
   for the surrounding double-quoted attribute. */
function escAttr(s){
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
function go(url){ window.location.href = url; }
// Sidebar "Invite friends" entry point, present on every logged-in page.
// On groups.html itself, open the quick-invite modal in place instead of
// a full page reload; everywhere else, navigate there with the trigger
// param so groups.html's init() opens it automatically after loading.
function goInvite(){
  if(location.pathname.endsWith('groups.html') && typeof openQuickInviteModal === 'function'){
    openQuickInviteModal();
  } else {
    window.location.href = 'groups.html?quickinvite=1';
  }
}

/* ── SIGN OUT ─────────────────────────────────────────────── */
/* Call from any page after `const sb = supabase.createClient(...)` exists.
   Signs out of Supabase and sends the user back to login.html. Does NOT
   touch local revm2_* keys, so re-login on the same device still has
   the cached tracker until the next pull/sync. */
async function signOutRevM2(){
  try{
    if(typeof sb !== 'undefined') await sb.auth.signOut();
  }catch(e){ /* ignore — still redirect below */ }
  window.location.href='login.html';
}

/* ── AUTH GUARD ───────────────────────────────────────────── */
/* Call at the top of any page that must be tied to a signed-in Google account.
   Redirects to login.html and returns null if there's no session. */
async function requireAuth(){
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
let __rm2DesktopAuthSyncStarted = false;
function startDesktopAuthSync(session){
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
function syncNativeAuthToken(session){
  if(typeof window.__TAURI__ === 'undefined' || !window.__TAURI__.core || !session) return;
  window.__TAURI__.core.invoke('sync_native_auth', {
    userId: session.user.id,
    accessToken: session.access_token,
    supabaseUrl: REVM2_CONFIG.SUPABASE_URL,
    supabaseAnonKey: REVM2_CONFIG.SUPABASE_ANON,
  }).catch(e=>console.error('RM2 desktop invoke error (sync_native_auth):', e));
}

// Silently pairs this desktop app instance with the signed-in account, the
// same way autoConnectExtension() (in blocks.html) pairs the browser
// extension - fires once per login, no click needed. Completely inert in
// a normal browser tab; window.__TAURI__ only exists when this page is
// loaded inside the desktop app's window.
async function autoConnectDesktop(userId){
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

/* ── ANALYTICS / EVENT LOGGING ───────────────────────────── */
/* Fire-and-forget. Call after `const sb = supabase.createClient(...)` exists on the page.
   Usage: logEvent('feature_used', 'timer'); logEvent('review_completed'); */
async function logEvent(eventType, feature=null, meta=null){
  try{
    if(typeof sb === 'undefined') return;
    const {data:{session}} = await sb.auth.getSession();
    if(!session) return;
    await sb.from('user_events').insert({
      user_id: session.user.id, event_type: eventType, feature, meta
    });
  }catch(e){ /* analytics must never break the app */ }
}

/* ── TRACKER SYNC (rows/slog ⇄ Supabase) ─────────────────── */
/* Debounced push of the local tracker snapshot to user_profiles. */
let _syncTimer=null;
function syncTrackerToSupabase(rows, slog){
  if(_syncTimer) clearTimeout(_syncTimer);
  _syncTimer=setTimeout(async()=>{
    try{
      if(typeof sb === 'undefined') return;
      const {data:{session}} = await sb.auth.getSession();
      if(!session) return;
      const totalSeconds = Object.values(slog||{}).reduce((sum,day)=>sum+Object.values(day).reduce((a,b)=>a+b,0),0);
      const totalDone = (rows||[]).reduce((sum,r)=>sum+INTERVALS.filter(iv=>r[iv.key]).length,0);
      await sb.from('user_profiles').update({
        tracker_data: rows, study_log: slog,
        total_study_seconds: totalSeconds, total_reviews_done: totalDone,
        last_active_at: new Date().toISOString()
      }).eq('id', session.user.id);
    }catch(e){ /* sync must never break the app */ }
  }, 1500);
}

/* Pull the latest snapshot from Supabase. Returns {rows,slog} or null if none saved yet. */
async function pullTrackerFromSupabase(){
  try{
    if(typeof sb === 'undefined') return null;
    const {data:{session}} = await sb.auth.getSession();
    if(!session) return null;
    const {data} = await sb.from('user_profiles').select('tracker_data,study_log').eq('id',session.user.id).single();
    if(!data || !data.tracker_data) return null;
    return { rows: data.tracker_data, slog: data.study_log||{} };
  }catch(e){ return null; }
}

/* Pull onboarding config (subjects/exam/track/dates) from Supabase.
   Used when a device has no local revm2_config yet — a new browser, a new
   device, or storage that got cleared — so an account that already
   finished onboarding isn't sent through it again just because *this*
   browser is blank. Returns null only when the account genuinely hasn't
   onboarded yet (real new user). */
async function pullConfigFromSupabase(){
  try{
    if(typeof sb === 'undefined') return null;
    const {data:{session}} = await sb.auth.getSession();
    if(!session) return null;
    const {data} = await sb.from('user_profiles')
      .select('subjects,exam,track,start_date,end_date,onboarded,explainer_seen')
      .eq('id',session.user.id).single();
    if(!data || !data.onboarded || !data.start_date) return null;
    return {
      subjects: data.subjects||[], exam: data.exam||null, track: data.track||null,
      start_date: data.start_date, end_date: data.end_date,
      onboarded: true, explainer_seen: data.explainer_seen!==false
    };
  }catch(e){ return null; }
}

/* ── EXAM SWITCHER ────────────────────────────────────────── */
/* Click the sidebar track/exam labels to change your exam track.
   Auto-wires on any page that has #sTrack + #sExam in the DOM —
   no per-page markup needed; the modal is built and injected into
   the page the first time it's opened. */
const EXAM_SWITCH_LIST = [
  ['JEE','JEE'],['NEET','NEET'],['IAT','IISER Aptitude'],['NEST','NEST'],
  ['BITSAT','BITSAT'],['CAT','CAT'],['UPSC CSE','UPSC CSE'],['SSC','SSC CGL/CHSL'],
  ['GATE','GATE'],['MHT-CET','MHT-CET'],['WBJEE','WBJEE'],['Other','Other']
];

function initExamSwitcher(){
  const t = document.getElementById('sTrack'), e = document.getElementById('sExam');
  if(!t || !e) return;
  [t, e].forEach(el=>{
    el.style.cursor = 'pointer';
    el.title = 'Click to change your exam';
    el.addEventListener('click', openExamSwitcher);
  });
}
document.addEventListener('DOMContentLoaded', initExamSwitcher);

function openExamSwitcher(){
  let modal = document.getElementById('examSwitchModal');
  if(!modal){
    document.body.insertAdjacentHTML('beforeend', `
      <style>
        #examSwitchModal .exam-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:0.6rem;margin-bottom:0.5rem;}
        #examSwitchModal .exam-card{border:1px solid var(--border2);background:var(--s2);padding:0.9rem 0.7rem;text-align:center;cursor:pointer;transition:all 0.15s;border-radius:8px;}
        #examSwitchModal .exam-card:hover{border-color:var(--gold-border);}
        #examSwitchModal .exam-card.selected{background:var(--gold-dim);border-color:var(--gold);}
        #examSwitchModal .exam-card-name{font-size:0.72rem;color:var(--text,#ccc);}
      </style>
      <div class="modal-overlay" id="examSwitchModal">
        <div class="modal">
          <h3>Change your exam</h3>
          <p>This updates your track everywhere, including Find a Partner eligibility.</p>
          <div class="exam-grid" id="examSwitchGrid"></div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="document.getElementById('examSwitchModal').classList.remove('show')">Cancel</button>
            <button class="btn btn-gold" id="examSwitchSaveBtn" onclick="saveExamSwitch()" disabled>Save</button>
          </div>
        </div>
      </div>`);
    modal = document.getElementById('examSwitchModal');
  }
  const grid = document.getElementById('examSwitchGrid');
  const current = (Store.get('revm2_config',{})||{}).exam || '';
  grid.innerHTML = EXAM_SWITCH_LIST.map(([v,l])=>
    `<div class="exam-card ${v===current?'selected':''}" data-v="${escAttr(v)}" onclick="pickExamSwitch(this)">
       <div class="exam-card-name">${escHtml(l)}</div>
     </div>`).join('');
  document.getElementById('examSwitchSaveBtn').disabled = !current;
  modal.classList.add('show');
}

function pickExamSwitch(el){
  document.querySelectorAll('#examSwitchGrid .exam-card').forEach(c=>c.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('examSwitchSaveBtn').disabled = false;
}

async function saveExamSwitch(){
  const picked = document.querySelector('#examSwitchGrid .exam-card.selected');
  if(!picked) return;
  const exam = picked.dataset.v;
  const track = exam + ' Track';
  const btn = document.getElementById('examSwitchSaveBtn');
  const origLabel = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving…';
  try{
    if(typeof sb === 'undefined') throw new Error('Not connected.');
    const {data:{session}} = await sb.auth.getSession();
    if(!session) throw new Error('Not signed in.');
    const {error} = await sb.from('user_profiles').update({ exam, track }).eq('id', session.user.id);
    if(error) throw error;

    const cfg = Store.get('revm2_config', {}) || {};
    cfg.exam = exam; cfg.track = track;
    Store.set('revm2_config', cfg);

    const tEl = document.getElementById('sTrack'), eEl = document.getElementById('sExam');
    if(tEl) tEl.textContent = track;
    if(eEl) eEl.textContent = exam;
    const topTrack = document.getElementById('topTrack');
    if(topTrack) topTrack.textContent = track;

    logEvent('exam_changed', 'settings', {exam});
    document.getElementById('examSwitchModal').classList.remove('show');
  }catch(err){
    alert(err.message || 'Could not save your exam right now — try again.');
  }finally{
    btn.disabled = false; btn.textContent = origLabel;
  }
}

/* ── TYPOGRAPHY REVEAL ────────────────────────────────────── */
/* Soft staggered word-by-word reveal for page headings (.topbar-title),
   paired with the display serif set in style.css. Auto-applies on every
   page that has a .topbar-title — no per-page markup needed. Re-runs
   automatically if a page swaps the heading text at runtime (tracker.html
   changes it when switching tabs), via MutationObserver. Skipped entirely
   for prefers-reduced-motion (CSS also hard-disables the animation as a
   second guard, in case this runs before that media query is evaluated). */
function rm2RevealHeading(el){
  if(!el || el.dataset.rm2Wrapping === '1') return;
  const text = el.textContent;
  if(!text || !text.trim()) return;
  el.dataset.rm2Wrapping = '1';
  const parts = text.split(/(\s+)/); // keep whitespace as its own tokens
  el.innerHTML = parts.map((w,i)=>{
    if(!w.trim()) return w;
    const delay = Math.min(i, 10) * 0.045;
    return `<span class="rm2-word" style="animation-delay:${delay.toFixed(3)}s">${escHtml(w)}</span>`;
  }).join('');
  requestAnimationFrame(()=>{ el.dataset.rm2Wrapping = '0'; });
}

function initTypographyReveal(){
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelectorAll('.topbar-title').forEach(el=>{
    rm2RevealHeading(el);
    const obs = new MutationObserver(()=>{
      if(el.dataset.rm2Wrapping === '1') return;
      rm2RevealHeading(el);
    });
    obs.observe(el, {childList:true, characterData:true, subtree:true});
  });
}
document.addEventListener('DOMContentLoaded', initTypographyReveal);

/* ── STARFIELD ───────────────────────────────────────────── */
function initStarfield(canvasId='starfield', count=240) {
  const canvas = document.getElementById(canvasId);
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  function resize(){ canvas.width=window.innerWidth; canvas.height=window.innerHeight; }
  resize(); window.addEventListener('resize', resize);
  const stars = Array.from({length:count}, ()=>({
    x:Math.random(), y:Math.random(),
    r:Math.random()*1.1+0.15,
    a:Math.random()*0.65+0.1,
    s:Math.random()*0.0003+0.00008
  }));
  let t=0;
  (function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height); t++;
    for(const s of stars){
      const alpha=Math.max(0, s.a+Math.sin(t*s.s*60+s.x*100)*0.18);
      ctx.beginPath();
      ctx.arc(s.x*canvas.width, s.y*canvas.height, s.r, 0, Math.PI*2);
      ctx.fillStyle=`rgba(255,255,255,${alpha})`; ctx.fill();
    }
    requestAnimationFrame(draw);
  })();
}

/* ── ROCKET LAUNCH SOUND ──────────────────────────────────── */
/* Synthesized with Web Audio (no audio file to host/license) — a short
   ignition rumble + whoosh, timed to the rocket's animateMotion (~1.4s). */
function isSoundOn(){ return Store.get('rm2_sound', true) !== false; }
function setSoundOn(on){ Store.set('rm2_sound', on); }

function playRocketLaunch(){
  if(!isSoundOn()) return;
  try{
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if(!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const dur = 1.3;

    // low rumble: pitch falls as the rocket climbs away
    const rumble = ctx.createOscillator();
    rumble.type = 'sawtooth';
    rumble.frequency.setValueAtTime(150, now);
    rumble.frequency.exponentialRampToValueAtTime(45, now + dur);
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.setValueAtTime(0, now);
    rumbleGain.gain.linearRampToValueAtTime(0.35, now + 0.05);
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    rumble.connect(rumbleGain);

    // noise burst: ignition + air whoosh
    const bufLen = ctx.sampleRate * dur;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for(let i=0;i<bufLen;i++) data[i] = Math.random()*2-1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(2200, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(300, now + dur);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0, now);
    noiseGain.gain.linearRampToValueAtTime(0.22, now + 0.04);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(noiseFilter); noiseFilter.connect(noiseGain);

    const master = ctx.createGain();
    master.gain.value = 0.9;
    rumbleGain.connect(master); noiseGain.connect(master);
    master.connect(ctx.destination);

    rumble.start(now); rumble.stop(now+dur);
    noise.start(now); noise.stop(now+dur);
    setTimeout(()=>{ try{ ctx.close(); }catch(e){} }, (dur+0.3)*1000);
  }catch(e){ /* sound is decorative — never break the page over it */ }
}

/* ── ANIMATED LOGO ───────────────────────────────────────── */
window.RevM2Logo = (()=>{
  function buildSVG(size){
    const full = size==='full';
    const id = 'L'+Math.random().toString(36).slice(2,7);
    return `<svg class="rm2-svg rm2-svg--${size}" viewBox="0 0 690 210"
        xmlns="http://www.w3.org/2000/svg" fill="none"
        role="img" aria-label="RevM² — Revision times Memory Squared">
      <defs>
        <linearGradient id="${id}g1" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="rgba(255,255,255,0)"/>
          <stop offset="40%" stop-color="rgba(255,255,255,0.45)"/>
          <stop offset="100%" stop-color="rgba(255,255,255,0.92)"/>
        </linearGradient>
        <linearGradient id="${id}g2" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="rgba(255,255,255,0)"/>
          <stop offset="100%" stop-color="rgba(255,255,255,0.14)"/>
        </linearGradient>
        <radialGradient id="${id}fl" cx="50%" cy="0%" r="100%">
          <stop offset="0%" stop-color="#ff9a3c"/>
          <stop offset="55%" stop-color="#c8a96e"/>
          <stop offset="100%" stop-color="rgba(200,169,110,0)"/>
        </radialGradient>
      </defs>

      <!-- REV italic -->
      <text x="18" y="148" font-family="Inter,Arial,sans-serif"
        font-weight="900" font-size="130" font-style="italic"
        letter-spacing="-4" fill="white">REV</text>

      <!-- M upright -->
      <text x="298" y="148" font-family="Inter,Arial,sans-serif"
        font-weight="900" font-size="130"
        letter-spacing="-4" fill="white">M</text>

      <!-- superscript X mark -->
      <line x1="432" y1="24" x2="474" y2="86" stroke="white" stroke-width="14" stroke-linecap="square"/>
      <line x1="478" y1="24" x2="428" y2="86" stroke="white" stroke-width="6" stroke-linecap="square"/>
      <!-- gold base bar -->
      <rect x="424" y="88" width="58" height="9" fill="#c8a96e"/>
      <!-- numeral 2 -->
      <text x="484" y="42" font-family="Inter,Arial,sans-serif"
        font-weight="900" font-size="32" fill="white">2</text>

      <!-- orbital trail (draws in as rocket flies) -->
      <path d="M 40 165 Q 180 210 340 138 Q 450 82 524 30"
        stroke="url(#${id}g1)" stroke-width="2.2" fill="none" stroke-linecap="round"
        stroke-dasharray="600" stroke-dashoffset="600">
        <animate attributeName="stroke-dashoffset"
          from="600" to="0" dur="1.5s" begin="0.1s" fill="freeze"
          calcMode="spline" keySplines="0.4 0 0.2 1"/>
      </path>
      <path d="M 58 170 Q 196 218 356 146 Q 462 92 534 40"
        stroke="url(#${id}g2)" stroke-width="1" fill="none" stroke-linecap="round"
        stroke-dasharray="620" stroke-dashoffset="620">
        <animate attributeName="stroke-dashoffset"
          from="620" to="0" dur="1.5s" begin="0.2s" fill="freeze"
          calcMode="spline" keySplines="0.4 0 0.2 1"/>
      </path>

      <!-- hidden motion path: R → above ² -->
      <path id="${id}path" d="M 40 165 Q 180 210 340 138 Q 450 82 516 20"
        fill="none" stroke="none" visibility="hidden"/>

      <!-- ROCKET GROUP -->
      <g id="${id}rkt">
        <!-- flame — flickers, fades on land -->
        <g opacity="1">
          <ellipse cx="0" cy="12" rx="4" ry="9" fill="url(#${id}fl)" opacity="0.85">
            <animate attributeName="ry" values="9;5;10;6;9" dur="0.16s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.85;0.5;0.9;0.55;0.85" dur="0.2s" repeatCount="indefinite"/>
          </ellipse>
          <animate attributeName="opacity" from="1" to="0"
            begin="${id}rkt.animateMotion.end" dur="0.4s" fill="freeze"/>
        </g>
        <!-- body -->
        <rect x="-6" y="-24" width="12" height="24" rx="2" fill="white"/>
        <!-- nosecone -->
        <polygon points="-6,-24 6,-24 0,-36" fill="white"/>
        <!-- fins -->
        <polygon points="-6,-6 -6,2 -13,2" fill="white"/>
        <polygon points="6,-6 6,2 13,2" fill="white"/>
        <!-- porthole -->
        <circle cx="0" cy="-15" r="3" fill="#000"/>
        <!-- nozzle -->
        <rect x="-3" y="0" width="6" height="8" rx="1" fill="#c8a96e"/>

        <!-- FLY from R to ² -->
        <animateMotion id="${id}rkt.animateMotion"
          dur="1.4s" begin="0s" fill="freeze"
          calcMode="spline" keySplines="0.25 0.1 0.25 1"
          keyPoints="0;1" keyTimes="0;1" rotate="auto">
          <mpath href="#${id}path"/>
        </animateMotion>

        <!-- idle bob after landing -->
        <animateTransform attributeName="transform" type="translate"
          values="0,0; 0,-2.5; 0,0; 0,-1.5; 0,0"
          dur="2.8s" begin="${id}rkt.animateMotion.end"
          repeatCount="indefinite" additive="sum"/>
      </g>

      ${full?`
      <rect x="18" y="162" width="556" height="1" fill="rgba(255,255,255,0.1)"/>
      <text x="18" y="183" font-family="Inter,Arial,sans-serif"
        font-weight="400" font-size="11" letter-spacing="5"
        fill="rgba(255,255,255,0.28)">REVISION × MEMORY — SQUARED</text>
      `:''}
    </svg>`;
  }

  function injectCSS(){
    if(document.getElementById('rm2-logo-css')) return;
    const s=document.createElement('style');
    s.id='rm2-logo-css';
    s.textContent=`
      .rm2-logo{display:inline-block;line-height:0;position:relative;}
      .rm2-svg{display:block;}
      .rm2-svg--full{width:min(520px,88vw);height:auto;}
      .rm2-svg--nav{width:150px;height:auto;}
      .rm2-svg--small{width:100px;height:auto;}
      .rm2-mute{position:absolute;top:-2px;right:-2px;width:26px;height:26px;border-radius:50%;
        border:1px solid var(--border2,rgba(255,255,255,0.15));background:rgba(0,0,0,0.4);
        color:rgba(255,255,255,0.55);font-size:12px;cursor:pointer;line-height:1;
        display:flex;align-items:center;justify-content:center;transition:color 0.2s,border-color 0.2s;}
      .rm2-mute:hover{color:#c8a96e;border-color:#c8a96e;}
    `;
    document.head.appendChild(s);
  }

  function init(){
    injectCSS();
    document.querySelectorAll('.rm2-logo').forEach(el=>{
      if(el.dataset.rm2Ready) return; // idempotent — never re-render/re-launch an already-hydrated logo
      el.dataset.rm2Ready='1';
      const size = el.dataset.size||'full';
      el.innerHTML=buildSVG(size);
      if(size==='full' && !el.dataset.noaudio){
        // launch sound fires alongside the rocket's animateMotion (begin="0s")
        playRocketLaunch();
        const btn=document.createElement('button');
        btn.className='rm2-mute'; btn.type='button';
        btn.title='Toggle launch sound';
        const SND_ON='<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
        const SND_OFF='<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4Z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/></svg>';
        btn.innerHTML = isSoundOn() ? SND_ON : SND_OFF;
        btn.onclick=(e)=>{
          e.stopPropagation();
          const on=!isSoundOn();
          setSoundOn(on);
          btn.innerHTML = on ? SND_ON : SND_OFF;
        };
        el.appendChild(btn);
      }
    });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
  return {init};
})();

/* ── GLOBAL LOADING OVERLAY ──────────────────────────────────
   A full-page overlay that shows the animated RevM² logo (small,
   silent) any time the app is buffering: initial auth check, a
   page's first data fetch, or a slow action. Include shared.js,
   then call RevM2Loader.show() as early as possible (before any
   await) and RevM2Loader.hide() once the page has real content.
   Safe to call show()/hide() many times; hide() is a no-op if
   never shown. Auto-hides after 12s as a safety net so a stalled
   fetch never leaves the whole page stuck behind the overlay. */
window.RevM2Loader = (()=>{
  let safetyTimer = null;
  function injectCSS(){
    if(document.getElementById('rm2-loader-css')) return;
    const s=document.createElement('style');
    s.id='rm2-loader-css';
    s.textContent=`
      #rm2-loader{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;
        justify-content:center;background:var(--black,#000);
        opacity:0;pointer-events:none;transition:opacity 0.25s ease;}
      #rm2-loader.rm2-loader--on{opacity:1;pointer-events:all;}
      #rm2-loader .rm2-loader-inner{display:flex;flex-direction:column;align-items:center;gap:0.9rem;}
      #rm2-loader .rm2-loader-msg{font-size:0.7rem;letter-spacing:0.12em;text-transform:uppercase;
        color:rgba(255,255,255,0.4);font-family:var(--font,inherit);}
    `;
    document.head.appendChild(s);
  }
  function ensure(){
    injectCSS();
    let ov = document.getElementById('rm2-loader');
    if(!ov){
      ov = document.createElement('div');
      ov.id='rm2-loader';
      ov.innerHTML = `<div class="rm2-loader-inner">
        <div class="rm2-logo" data-size="small" data-noaudio="1"></div>
        <div class="rm2-loader-msg" id="rm2-loader-msg">Loading…</div>
      </div>`;
      document.body.appendChild(ov);
    }
    return ov;
  }
  function show(message){
    const ov = ensure();
    const msgEl = document.getElementById('rm2-loader-msg');
    if(msgEl) msgEl.textContent = message || 'Loading…';
    ov.classList.add('rm2-loader--on');
    window.RevM2Logo.init(); // hydrate the logo svg if this is its first show
    clearTimeout(safetyTimer);
    safetyTimer = setTimeout(hide, 12000); // never trap the user behind the overlay
  }
  function hide(){
    const ov = document.getElementById('rm2-loader');
    if(ov) ov.classList.remove('rm2-loader--on');
    clearTimeout(safetyTimer);
  }
  return { show, hide };
})();

/* ── CALL RINGTONE — synthesized with Web Audio (same no-file approach as
   the rocket-launch sound above). Shared by chat.html's in-call ring UI
   AND the cross-page RevM2Calls toast below, so there's one ring sound
   site-wide. Loops until stopCallRingtone() is called. */
let _ringAudioCtx = null, _ringLoopTimer = null;
function startCallRingtone(){
  stopCallRingtone();
  if(!isSoundOn()) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if(!Ctx) return;
  _ringAudioCtx = new Ctx();
  const ringOnce = () => {
    if(!_ringAudioCtx) return;
    const now = _ringAudioCtx.currentTime;
    [0, 0.45].forEach(offset=>{
      const osc = _ringAudioCtx.createOscillator();
      const gain = _ringAudioCtx.createGain();
      osc.type = 'sine'; osc.frequency.value = 440;
      gain.gain.setValueAtTime(0, now+offset);
      gain.gain.linearRampToValueAtTime(0.18, now+offset+0.05);
      gain.gain.linearRampToValueAtTime(0, now+offset+0.38);
      osc.connect(gain); gain.connect(_ringAudioCtx.destination);
      osc.start(now+offset); osc.stop(now+offset+0.4);
    });
  };
  ringOnce();
  _ringLoopTimer = setInterval(ringOnce, 1600);
}
function stopCallRingtone(){
  clearInterval(_ringLoopTimer); _ringLoopTimer = null;
  if(_ringAudioCtx){ try{ _ringAudioCtx.close(); }catch(e){} _ringAudioCtx = null; }
}

/* ── BROWSER NOTIFICATION for an incoming call — fires even if the tab
   isn't focused, so a call doesn't just silently ring out unseen. */
let _ringNotification = null;
function notifyIncomingCall(name){
  if(!('Notification' in window) || Notification.permission!=='granted') return;
  try{
    _ringNotification = new Notification('Incoming call', {
      body: `${name||'Someone'} is calling you on RevM²`,
      icon: 'icon-192.png', tag: 'revm2-incoming-call', requireInteraction: true
    });
    _ringNotification.onclick = () => { window.focus(); _ringNotification.close(); };
  }catch(e){ /* notifications are a nice-to-have, never break the call */ }
}
function closeCallNotification(){ if(_ringNotification){ _ringNotification.close(); _ringNotification=null; } }

/* ── GLOBAL CROSS-PAGE INCOMING-CALL TOAST ───────────────────
   chat.html's call system only ever rang on the exact chat.html?fid=
   page for that friendship — if you were on tracker/groups/store/etc.
   when someone called, you never knew. This listens for a call ping
   on a per-user channel (sent by chat.html's startCall alongside its
   normal per-friendship ring) and shows a small Accept/Decline toast
   with ringtone + Notification, from ANY page. Call RevM2Calls.init(sb,
   myUserId) once per page, right after a session exists. Idempotent —
   safe to call more than once; safe to never call at all. */
window.RevM2Calls = (()=>{
  let channel = null, activeToast = null;

  function injectCSS(){
    if(document.getElementById('rm2-call-toast-css')) return;
    const s=document.createElement('style');
    s.id='rm2-call-toast-css';
    s.textContent=`
      #rm2-call-toast{position:fixed;top:16px;right:16px;z-index:99998;
        background:rgba(10,10,14,0.97);border:1px solid rgba(200,169,110,0.4);
        border-radius:12px;padding:0.9rem 1rem;display:flex;align-items:center;gap:0.75rem;
        box-shadow:0 8px 32px rgba(0,0,0,0.5);font-family:inherit;max-width:300px;
        animation:rm2CallIn 0.25s ease;}
      @keyframes rm2CallIn{from{opacity:0;transform:translateY(-10px);}to{opacity:1;transform:translateY(0);}}
      #rm2-call-toast .rm2ct-avatar{width:42px;height:42px;border-radius:50%;flex-shrink:0;
        background:#1a1a1f;overflow:hidden;display:flex;align-items:center;justify-content:center;
        border:2px solid rgba(200,169,110,0.5);color:#c8a96e;font-weight:700;font-size:0.9rem;}
      #rm2-call-toast .rm2ct-avatar img{width:100%;height:100%;object-fit:cover;}
      #rm2-call-toast .rm2ct-name{font-size:0.82rem;font-weight:700;color:#fff;}
      #rm2-call-toast .rm2ct-sub{font-size:0.68rem;color:rgba(255,255,255,0.55);margin-top:0.1rem;}
      #rm2-call-toast .rm2ct-btns{display:flex;gap:0.4rem;margin-left:auto;}
      #rm2-call-toast button{width:34px;height:34px;border-radius:50%;border:none;cursor:pointer;
        display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;}
      #rm2-call-toast .rm2ct-accept{background:radial-gradient(circle at 35% 30%,#5be89a,#1fae63);}
      #rm2-call-toast .rm2ct-decline{background:radial-gradient(circle at 35% 30%,#fb7373,#e03e3e);}
    `;
    document.head.appendChild(s);
  }

  function dismiss(){
    if(activeToast){ activeToast.remove(); activeToast=null; }
    stopCallRingtone();
    closeCallNotification();
  }

  function showToast(sb, payload){
    dismiss();
    injectCSS();
    const name = payload.fromUsername ? '@'+payload.fromUsername : 'Someone';
    const el = document.createElement('div');
    el.id = 'rm2-call-toast';
    el.innerHTML = `
      <div class="rm2ct-avatar">${payload.fromAvatarUrl ? `<img src="${escHtml(payload.fromAvatarUrl)}">` : (payload.fromUsername||'?').charAt(0).toUpperCase()}</div>
      <div><div class="rm2ct-name">${escHtml(name)}</div><div class="rm2ct-sub">Incoming ${payload.callType==='video'?'video':'voice'} call…</div></div>
      <div class="rm2ct-btns">
        <button class="rm2ct-decline" title="Decline">✕</button>
        <button class="rm2ct-accept" title="Accept">${payload.callType==='video'?'▶':'📞'}</button>
      </div>`;
    document.body.appendChild(el);
    activeToast = el;
    startCallRingtone();
    notifyIncomingCall(name);
    el.querySelector('.rm2ct-decline').onclick = () => {
      dismiss();
      try{
        const declineCh = sb.channel(`dm-call-${payload.fid}`);
        declineCh.subscribe(status=>{
          if(status==='SUBSCRIBED'){
            declineCh.send({ type:'broadcast', event:'call', payload:{ from:payload.toUserId, to:payload.fromUserId, kind:'decline' } });
            setTimeout(()=>sb.removeChannel(declineCh), 800);
          }
        });
      }catch(e){}
    };
    el.querySelector('.rm2ct-accept').onclick = () => {
      dismiss();
      window.location.href = `chat.html?fid=${payload.fid}&call=${payload.callType}&autoaccept=1`;
    };
  }

  function init(sb, myUserId){
    if(channel || !myUserId || !sb) return; // idempotent
    channel = sb.channel(`user-calls-${myUserId}`)
      .on('broadcast', { event:'incoming_call' }, ({payload}) => {
        // If chat.html is already open for this exact friendship, its own
        // per-friendship ring already handles it — don't double-toast.
        if(location.pathname.endsWith('chat.html') && new URLSearchParams(location.search).get('fid')===payload.fid) return;
        showToast(sb, payload);
      })
      .subscribe();
    if('Notification' in window && Notification.permission==='default') Notification.requestPermission();
  }

  return { init };
})();

/* ── UNREAD MESSAGES + MISSED CALLS ───────────────────────────
   Puts a live count badge on the sidebar's "Study Partners" nav item
   (id="navPartnersBadge", added to every app page's sidebar) and pops
   a small toast when a friend messages you or a call goes unanswered,
   from ANY page — not just when partners.html/chat.html happens to be
   open. Call RevM2Notifications.init(sb, myUserId) once per page,
   right after a session exists. Idempotent; safe to never call. */
window.RevM2Notifications = (()=>{
  let channel = null, sbRef = null, myId = null;
  const senderCache = {}; // user_id -> {username, avatar_url}, best-effort memoization

  function badgeEl(){ return document.getElementById('navPartnersBadge'); }

  async function refreshCounts(){
    if(!sbRef || !myId) return;
    try{
      const { data } = await sbRef.from('dm_messages')
        .select('kind,call_status').eq('recipient_id', myId).is('read_at', null);
      const rows = data || [];
      const unreadMsgs = rows.filter(r=>r.kind==='text').length;
      const missedCalls = rows.filter(r=>r.kind==='call_log' && r.call_status==='missed').length;
      const total = unreadMsgs + missedCalls;
      const el = badgeEl();
      if(el){
        el.style.display = total>0 ? 'inline-flex' : 'none';
        el.textContent = total>9 ? '9+' : String(total);
        el.title = `${unreadMsgs} unread message${unreadMsgs===1?'':'s'} · ${missedCalls} missed call${missedCalls===1?'':'s'}`;
      }
    }catch(e){ /* badge is a nice-to-have, never break the page */ }
  }

  async function senderInfo(userId){
    if(senderCache[userId]) return senderCache[userId];
    try{
      const { data } = await sbRef.from('user_profiles').select('username,avatar_url').eq('id', userId).single();
      senderCache[userId] = data || {};
    }catch(e){ senderCache[userId] = {}; }
    return senderCache[userId];
  }

  function injectCSS(){
    if(document.getElementById('rm2-notify-toast-css')) return;
    const s=document.createElement('style');
    s.id='rm2-notify-toast-css';
    s.textContent=`
      #rm2-notify-toast{position:fixed;top:16px;right:16px;z-index:99997;
        background:rgba(10,10,14,0.97);border:1px solid rgba(200,169,110,0.4);
        border-radius:12px;padding:0.85rem 1rem;display:flex;align-items:center;gap:0.7rem;
        box-shadow:0 8px 32px rgba(0,0,0,0.5);font-family:inherit;max-width:290px;
        cursor:pointer;animation:rm2CallIn 0.25s ease;}
      #rm2-notify-toast .rm2nt-avatar{width:38px;height:38px;border-radius:50%;flex-shrink:0;
        background:#1a1a1f;overflow:hidden;display:flex;align-items:center;justify-content:center;
        border:2px solid rgba(200,169,110,0.5);color:#c8a96e;font-weight:700;font-size:0.85rem;}
      #rm2-notify-toast .rm2nt-avatar img{width:100%;height:100%;object-fit:cover;}
      #rm2-notify-toast .rm2nt-name{font-size:0.8rem;font-weight:700;color:#fff;}
      #rm2-notify-toast .rm2nt-sub{font-size:0.7rem;color:rgba(255,255,255,0.6);margin-top:0.15rem;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      #rm2-notify-toast .rm2nt-close{margin-left:auto;background:none;border:none;color:rgba(255,255,255,0.4);
        font-size:0.95rem;cursor:pointer;flex-shrink:0;}
    `;
    document.head.appendChild(s);
  }

  async function showToast(kind, row){
    injectCSS();
    const existing = document.getElementById('rm2-notify-toast');
    if(existing) existing.remove();
    const sender = await senderInfo(row.sender_id);
    const name = sender.username ? '@'+sender.username : 'Someone';
    const sub = kind==='message'
      ? escHtml((row.body||'').slice(0,60))
      : `Missed ${row.call_type==='video'?'video':'voice'} call`;
    const el = document.createElement('div');
    el.id = 'rm2-notify-toast';
    el.innerHTML = `
      <div class="rm2nt-avatar">${sender.avatar_url ? `<img src="${escHtml(sender.avatar_url)}">` : name.charAt(1)?.toUpperCase()||'?'}</div>
      <div style="min-width:0;"><div class="rm2nt-name">${escHtml(name)}</div><div class="rm2nt-sub">${sub}</div></div>
      <button class="rm2nt-close" title="Dismiss">✕</button>`;
    document.body.appendChild(el);
    el.querySelector('.rm2nt-close').onclick = (e) => { e.stopPropagation(); el.remove(); };
    el.onclick = () => { window.location.href = `chat.html?fid=${row.friendship_id}`; };
    setTimeout(()=>{ if(el.parentNode) el.remove(); }, 8000);
    if('Notification' in window && Notification.permission==='granted'){
      try{
        const n = new Notification(kind==='message' ? `${name} messaged you` : `Missed call from ${name}`, {
          body: kind==='message' ? (row.body||'').slice(0,80) : `You missed a ${row.call_type==='video'?'video':'voice'} call`,
          icon:'icon-192.png', tag:'revm2-'+kind
        });
        n.onclick = () => { window.focus(); window.location.href = `chat.html?fid=${row.friendship_id}`; };
      }catch(e){}
    }
  }

  function init(sb, myUserId){
    if(channel || !myUserId || !sb) return; // idempotent
    sbRef = sb; myId = myUserId;
    refreshCounts();
    channel = sb.channel(`user-notify-${myUserId}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'dm_messages', filter:`recipient_id=eq.${myUserId}` }, ({ new: row }) => {
        refreshCounts();
        // If chat.html is already open for this exact conversation, it already
        // shows the message/call-log inline and marks it read — no toast needed.
        const onThisChat = location.pathname.endsWith('chat.html') && new URLSearchParams(location.search).get('fid')===row.friendship_id;
        if(onThisChat) return;
        if(row.kind==='text') showToast('message', row);
        else if(row.kind==='call_log' && row.call_status==='missed') showToast('missed_call', row);
      })
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'dm_messages', filter:`recipient_id=eq.${myUserId}` }, () => refreshCounts())
      .subscribe();
    if('Notification' in window && Notification.permission==='default') Notification.requestPermission();
  }

  return { init, refreshCounts };
})();

/* ── MOBILE SIDEBAR (hamburger drawer) ──────────────────────
   Used on pages with the .sidebar app-shell (tracker, groups,
   store, calculator, predictor). Sidebar itself stays in the
   DOM at all times — this just toggles a class + backdrop so
   desktop layout/CSS is completely unaffected. ──────────── */
function openMobileSidebar(){
  const sb = document.querySelector('.sidebar');
  const bd = document.getElementById('sidebarBackdrop');
  if(sb) sb.classList.add('mobile-open');
  if(bd) bd.classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeMobileSidebar(){
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
function initSidebarHoverReveal(){
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
const RM2_REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Animate a number from its current displayed value up/down to `target`.
   Safe to call repeatedly (e.g. on every refetch) — reads the currently
   shown number as the start point so it never "restarts from 0" on a
   simple re-render. Non-numeric current text is treated as starting at 0. */
function rm2AnimateNumber(el, target, opts={}){
  if(!el) return;
  target = Number(target)||0;
  if(RM2_REDUCED_MOTION){ el.textContent = opts.format ? opts.format(target) : target.toLocaleString(); return; }
  const startVal = parseFloat((el.textContent||'').replace(/[^0-9.-]/g,'')) || 0;
  if(startVal === target){ el.textContent = opts.format ? opts.format(target) : target.toLocaleString(); return; }
  const duration = opts.duration || 600;
  const t0 = performance.now();
  const ease = t => 1 - Math.pow(1-t, 3); // ease-out cubic
  function tick(now){
    const p = Math.min(1, (now-t0)/duration);
    const val = Math.round(startVal + (target-startVal)*ease(p));
    el.textContent = opts.format ? opts.format(val) : val.toLocaleString();
    if(p < 1) requestAnimationFrame(tick);
    else{
      el.classList.remove('rm2-count-landed'); void el.offsetWidth; el.classList.add('rm2-count-landed');
    }
  }
  requestAnimationFrame(tick);
}

/* Add staggered fade-up entrance to a freshly-rendered list of elements.
   Call right after setting .innerHTML on a container:
     container.innerHTML = items.map(renderItem).join('');
     rm2Stagger(container.children);
   Each child gets .rm2-in with an incremental delay (capped so long
   lists don't take forever to finish appearing). */
function rm2Stagger(nodeList, opts={}){
  if(RM2_REDUCED_MOTION) return;
  const step = opts.step ?? 35;   // ms between each item
  const cap = opts.cap ?? 10;     // stop increasing delay after N items
  Array.from(nodeList).forEach((el,i)=>{
    el.style.setProperty('--d', `${Math.min(i,cap)*step}ms`);
    el.classList.add('rm2-in');
  });
}
