/* ============================================================
   RevM² — shared.js
   Animated logo component + shared constants + utilities
   Load BEFORE supabase on every page.
   ============================================================ */

/* ── SUPABASE CONFIG ─────────────────────────────────────── */
const REVM2_CONFIG = {
  SUPABASE_URL:  'https://dhzjtjekbvxxsauzhadl.supabase.co',
  SUPABASE_ANON: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoemp0amVrYnZ4eHNhdXpoYWRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNjQ2NjUsImV4cCI6MjA5Nzk0MDY2NX0.2Uo36DtE7NpwW5wxOEwnmWjbXhHWXV-wf6qc7kXDtYE'
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
    return session;
  }catch(e){ window.location.href='login.html'; return null; }
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
      const size = el.dataset.size||'full';
      el.innerHTML=buildSVG(size);
      if(size==='full'){
        // launch sound fires alongside the rocket's animateMotion (begin="0s")
        playRocketLaunch();
        const btn=document.createElement('button');
        btn.className='rm2-mute'; btn.type='button';
        btn.title='Toggle launch sound';
        btn.textContent = isSoundOn() ? '🔊' : '🔇';
        btn.onclick=(e)=>{
          e.stopPropagation();
          const on=!isSoundOn();
          setSoundOn(on);
          btn.textContent = on ? '🔊' : '🔇';
        };
        el.appendChild(btn);
      }
    });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
  return {init};
})();
