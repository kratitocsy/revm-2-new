var RevM2Shared = function(exports) {
  "use strict";
  const REVM2_CONFIG = {
    SUPABASE_URL: "https://dhzjtjekbvxxsauzhadl.supabase.co",
    SUPABASE_ANON: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoemp0amVrYnZ4eHNhdXpoYWRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNjQ2NjUsImV4cCI6MjA5Nzk0MDY2NX0.2Uo36DtE7NpwW5wxOEwnmWjbXhHWXV-wf6qc7kXDtYE",
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
    GOOGLE_API_KEY: "",
    GOOGLE_CLIENT_ID: "",
    /* ── Telegram Login (sign-in via @revm2_bot) ──────────────────────
     * The numeric bot ID - the digits before the ':' in your bot token
     * from @BotFather (e.g. token "1234567890:AAF..." → bot ID
     * "1234567890"). NOT the bot's username or its token itself - this
     * ID is public-safe, unlike the token.
     * Also required, done once in Telegram itself, not here:
     *   message @BotFather → /setdomain → @revm2_bot → your production
     *   domain (e.g. revm-2-new.vercel.app) - the widget only works on
     *   a domain the bot has explicitly allowed.
     * Leave empty to hide the "Continue with Telegram" button. */
    TELEGRAM_BOT_ID: ""
  };
  const INTERVALS = [
    { key: "r0", label: "5m", days: 0 },
    { key: "r1", label: "12h", days: 0.5 },
    { key: "r2", label: "+1D", days: 1 },
    { key: "r3", label: "+2D", days: 2 },
    { key: "r4", label: "+4D", days: 4 },
    { key: "r5", label: "+7D", days: 7 },
    { key: "r6", label: "+15D", days: 15 },
    { key: "r7", label: "+30D", days: 30 }
  ];
  const config = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    INTERVALS,
    REVM2_CONFIG
  }, Symbol.toStringTag, { value: "Module" }));
  const Store = {
    get: (k, fallback = null) => {
      try {
        const v = localStorage.getItem(k);
        return v ? JSON.parse(v) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {
      }
    },
    del: (k) => {
      try {
        localStorage.removeItem(k);
      } catch (e) {
      }
    }
  };
  const store = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    Store
  }, Symbol.toStringTag, { value: "Module" }));
  const TODAY = (() => {
    const d = /* @__PURE__ */ new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  })();
  const TODAY_STR = TODAY.toISOString().split("T")[0];
  function fmtDateShort(d) {
    return (/* @__PURE__ */ new Date(d + "T00:00:00")).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }
  function fmtDateFull(d) {
    return (/* @__PURE__ */ new Date(d + "T00:00:00")).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }
  function fmtTime(secs) {
    const h = Math.floor(secs / 3600), m = Math.floor(secs % 3600 / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  function escHtml(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function escAttr(s) {
    s = String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  const format = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    TODAY,
    TODAY_STR,
    escAttr,
    escHtml,
    fmtDateFull,
    fmtDateShort,
    fmtTime
  }, Symbol.toStringTag, { value: "Module" }));
  function go(url) {
    window.location.href = url;
  }
  function goInvite() {
    if (location.pathname.endsWith("groups.html") && typeof openQuickInviteModal === "function") {
      openQuickInviteModal();
    } else {
      window.location.href = "groups.html?quickinvite=1";
    }
  }
  const nav = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    go,
    goInvite
  }, Symbol.toStringTag, { value: "Module" }));
  async function signOutRevM2() {
    try {
      if (typeof sb !== "undefined") {
        const { data: { session } } = await sb.auth.getSession();
        if (session) {
          try {
            const { data: activeSession } = await sb.from("focus_lock_sessions").select("ends_at, unlimited, paused_until").eq("user_id", session.user.id).eq("active", true).maybeSingle();
            const genuinelyActive = activeSession && !(activeSession.paused_until && new Date(activeSession.paused_until) > /* @__PURE__ */ new Date());
            if (genuinelyActive) {
              const until = !activeSession.unlimited && activeSession.ends_at ? " (ends " + new Date(activeSession.ends_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + ")" : "";
              alert("You have an active focus block right now" + until + " — signing out is disabled while it's running. Go to Blocks to end it early (code unlock / emergency unlock still work) if you need to stop.");
              return;
            }
          } catch (checkErr) {
            console.error("RM2 active-session check failed, proceeding with sign-out:", checkErr);
          }
        }
        await sb.auth.signOut();
      }
    } catch (e) {
    }
    window.location.href = "login.html";
  }
  async function requireAuth() {
    try {
      if (typeof sb === "undefined") {
        window.location.href = "login.html";
        return null;
      }
      const { data: { session } } = await sb.auth.getSession();
      if (!session) {
        window.location.href = "login.html";
        return null;
      }
      startDesktopAuthSync(session);
      return session;
    } catch (e) {
      window.location.href = "login.html";
      return null;
    }
  }
  exports.__rm2DesktopAuthSyncStarted = false;
  function startDesktopAuthSync(session) {
    if (typeof window.__TAURI__ === "undefined" || !session) return;
    autoConnectDesktop(session.user.id);
    syncNativeAuthToken(session);
    if (exports.__rm2DesktopAuthSyncStarted) return;
    exports.__rm2DesktopAuthSyncStarted = true;
    sb.auth.onAuthStateChange((_event, newSession) => {
      syncNativeAuthToken(newSession);
    });
  }
  (function() {
    if (typeof window.__TAURI__ === "undefined") return;
    function start() {
      if (typeof sb === "undefined") {
        setTimeout(start, 150);
        return;
      }
      sb.auth.getSession().then(({ data: { session } }) => {
        if (session) startDesktopAuthSync(session);
      }).catch(() => {
      });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  })();
  function syncNativeAuthToken(session) {
    if (typeof window.__TAURI__ === "undefined" || !window.__TAURI__.core || !session) return;
    window.__TAURI__.core.invoke("sync_native_auth", {
      userId: session.user.id,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      supabaseUrl: REVM2_CONFIG.SUPABASE_URL,
      supabaseAnonKey: REVM2_CONFIG.SUPABASE_ANON
    }).catch((e) => console.error("RM2 desktop invoke error (sync_native_auth):", e));
  }
  async function autoConnectDesktop(userId) {
    if (typeof window.__TAURI__ === "undefined") return;
    try {
      const invoke = window.__TAURI__.core.invoke;
      const existing = await invoke("get_token").catch(() => "");
      if (existing) return;
      const raw = crypto.randomUUID() + crypto.randomUUID();
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
      const hash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
      const { error } = await sb.from("extension_sync_tokens").insert({
        token_hash: hash,
        user_id: userId,
        label: "Desktop app"
      });
      if (error) return;
      await invoke("save_token", { token: raw });
    } catch (e) {
    }
  }
  const auth = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    get __rm2DesktopAuthSyncStarted() {
      return exports.__rm2DesktopAuthSyncStarted;
    },
    autoConnectDesktop,
    requireAuth,
    signOutRevM2,
    startDesktopAuthSync,
    syncNativeAuthToken
  }, Symbol.toStringTag, { value: "Module" }));
  async function logEvent(eventType, feature = null, meta = null) {
    try {
      if (typeof sb === "undefined") return;
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return;
      await sb.from("user_events").insert({
        user_id: session.user.id,
        event_type: eventType,
        feature,
        meta
      });
    } catch (e) {
    }
  }
  const analytics = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    logEvent
  }, Symbol.toStringTag, { value: "Module" }));
  exports._syncTimer = null;
  function syncTrackerToSupabase(rows, slog) {
    if (exports._syncTimer) clearTimeout(exports._syncTimer);
    exports._syncTimer = setTimeout(async () => {
      try {
        if (typeof sb === "undefined") return;
        const { data: { session } } = await sb.auth.getSession();
        if (!session) return;
        const totalSeconds = Object.values(slog || {}).reduce((sum, day) => sum + Object.values(day).reduce((a, b) => a + b, 0), 0);
        const totalDone = (rows || []).reduce((sum, r) => sum + INTERVALS.filter((iv) => r[iv.key]).length, 0);
        await sb.from("user_profiles").update({
          tracker_data: rows,
          study_log: slog,
          total_study_seconds: totalSeconds,
          total_reviews_done: totalDone,
          last_active_at: (/* @__PURE__ */ new Date()).toISOString()
        }).eq("id", session.user.id);
      } catch (e) {
      }
    }, 1500);
  }
  async function pullTrackerFromSupabase() {
    try {
      if (typeof sb === "undefined") return null;
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return null;
      const { data } = await sb.from("user_profiles").select("tracker_data,study_log").eq("id", session.user.id).single();
      if (!data || !data.tracker_data) return null;
      return { rows: data.tracker_data, slog: data.study_log || {} };
    } catch (e) {
      return null;
    }
  }
  async function pullConfigFromSupabase() {
    try {
      if (typeof sb === "undefined") return null;
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return null;
      const { data } = await sb.from("user_profiles").select("subjects,exam,track,start_date,end_date,onboarded,explainer_seen").eq("id", session.user.id).single();
      if (!data || !data.onboarded || !data.start_date) return null;
      return {
        subjects: data.subjects || [],
        exam: data.exam || null,
        track: data.track || null,
        start_date: data.start_date,
        end_date: data.end_date,
        onboarded: true,
        explainer_seen: data.explainer_seen !== false
      };
    } catch (e) {
      return null;
    }
  }
  const trackerSync = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    get _syncTimer() {
      return exports._syncTimer;
    },
    pullConfigFromSupabase,
    pullTrackerFromSupabase,
    syncTrackerToSupabase
  }, Symbol.toStringTag, { value: "Module" }));
  const EXAM_SWITCH_LIST = [
    ["JEE", "JEE"],
    ["NEET", "NEET"],
    ["IAT", "IISER Aptitude"],
    ["NEST", "NEST"],
    ["BITSAT", "BITSAT"],
    ["CAT", "CAT"],
    ["UPSC CSE", "UPSC CSE"],
    ["SSC", "SSC CGL/CHSL"],
    ["GATE", "GATE"],
    ["MHT-CET", "MHT-CET"],
    ["WBJEE", "WBJEE"],
    ["Other", "Other"]
  ];
  function initExamSwitcher() {
    const t = document.getElementById("sTrack"), e = document.getElementById("sExam");
    if (!t || !e) return;
    [t, e].forEach((el) => {
      el.style.cursor = "pointer";
      el.title = "Click to change your exam";
      el.addEventListener("click", openExamSwitcher);
    });
  }
  document.addEventListener("DOMContentLoaded", initExamSwitcher);
  function openExamSwitcher() {
    let modal = document.getElementById("examSwitchModal");
    if (!modal) {
      document.body.insertAdjacentHTML("beforeend", `
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
      modal = document.getElementById("examSwitchModal");
    }
    const grid = document.getElementById("examSwitchGrid");
    const current = (Store.get("revm2_config", {}) || {}).exam || "";
    grid.innerHTML = EXAM_SWITCH_LIST.map(([v, l]) => `<div class="exam-card ${v === current ? "selected" : ""}" data-v="${escAttr(v)}" onclick="pickExamSwitch(this)">
       <div class="exam-card-name">${escHtml(l)}</div>
     </div>`).join("");
    document.getElementById("examSwitchSaveBtn").disabled = !current;
    modal.classList.add("show");
  }
  function pickExamSwitch(el) {
    document.querySelectorAll("#examSwitchGrid .exam-card").forEach((c) => c.classList.remove("selected"));
    el.classList.add("selected");
    document.getElementById("examSwitchSaveBtn").disabled = false;
  }
  async function saveExamSwitch() {
    const picked = document.querySelector("#examSwitchGrid .exam-card.selected");
    if (!picked) return;
    const exam = picked.dataset.v;
    const track = exam + " Track";
    const btn = document.getElementById("examSwitchSaveBtn");
    const origLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      if (typeof sb === "undefined") throw new Error("Not connected.");
      const { data: { session } } = await sb.auth.getSession();
      if (!session) throw new Error("Not signed in.");
      const { error } = await sb.from("user_profiles").update({ exam, track }).eq("id", session.user.id);
      if (error) throw error;
      const cfg = Store.get("revm2_config", {}) || {};
      cfg.exam = exam;
      cfg.track = track;
      Store.set("revm2_config", cfg);
      const tEl = document.getElementById("sTrack"), eEl = document.getElementById("sExam");
      if (tEl) tEl.textContent = track;
      if (eEl) eEl.textContent = exam;
      const topTrack = document.getElementById("topTrack");
      if (topTrack) topTrack.textContent = track;
      logEvent("exam_changed", "settings", { exam });
      document.getElementById("examSwitchModal").classList.remove("show");
    } catch (err) {
      alert(err.message || "Could not save your exam right now — try again.");
    } finally {
      btn.disabled = false;
      btn.textContent = origLabel;
    }
  }
  const examSwitcher = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    EXAM_SWITCH_LIST,
    initExamSwitcher,
    openExamSwitcher,
    pickExamSwitch,
    saveExamSwitch
  }, Symbol.toStringTag, { value: "Module" }));
  function rm2RevealHeading(el) {
    if (!el || el.dataset.rm2Wrapping === "1") return;
    const text = el.textContent;
    if (!text || !text.trim()) return;
    el.dataset.rm2Wrapping = "1";
    const parts = text.split(/(\s+)/);
    el.innerHTML = parts.map((w, i) => {
      if (!w.trim()) return w;
      const delay = Math.min(i, 10) * 0.045;
      return `<span class="rm2-word" style="animation-delay:${delay.toFixed(3)}s">${escHtml(w)}</span>`;
    }).join("");
    requestAnimationFrame(() => {
      el.dataset.rm2Wrapping = "0";
    });
  }
  function initTypographyReveal() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.querySelectorAll(".topbar-title").forEach((el) => {
      rm2RevealHeading(el);
      const obs = new MutationObserver(() => {
        if (el.dataset.rm2Wrapping === "1") return;
        rm2RevealHeading(el);
      });
      obs.observe(el, { childList: true, characterData: true, subtree: true });
    });
  }
  document.addEventListener("DOMContentLoaded", initTypographyReveal);
  const typographyReveal = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    initTypographyReveal,
    rm2RevealHeading
  }, Symbol.toStringTag, { value: "Module" }));
  function initStarfield(canvasId = "starfield", count = 240) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);
    const stars = Array.from({ length: count }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.1 + 0.15,
      a: Math.random() * 0.65 + 0.1,
      s: Math.random() * 3e-4 + 8e-5
    }));
    let t = 0;
    (function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      t++;
      for (const s of stars) {
        const alpha = Math.max(0, s.a + Math.sin(t * s.s * 60 + s.x * 100) * 0.18);
        ctx.beginPath();
        ctx.arc(s.x * canvas.width, s.y * canvas.height, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.fill();
      }
      requestAnimationFrame(draw);
    })();
  }
  const starfield = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    initStarfield
  }, Symbol.toStringTag, { value: "Module" }));
  function isSoundOn() {
    return Store.get("rm2_sound", true) !== false;
  }
  function setSoundOn(on) {
    Store.set("rm2_sound", on);
  }
  function playRocketLaunch() {
    if (!isSoundOn()) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      const dur = 1.3;
      const rumble = ctx.createOscillator();
      rumble.type = "sawtooth";
      rumble.frequency.setValueAtTime(150, now);
      rumble.frequency.exponentialRampToValueAtTime(45, now + dur);
      const rumbleGain = ctx.createGain();
      rumbleGain.gain.setValueAtTime(0, now);
      rumbleGain.gain.linearRampToValueAtTime(0.35, now + 0.05);
      rumbleGain.gain.exponentialRampToValueAtTime(1e-3, now + dur);
      rumble.connect(rumbleGain);
      const bufLen = ctx.sampleRate * dur;
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = "lowpass";
      noiseFilter.frequency.setValueAtTime(2200, now);
      noiseFilter.frequency.exponentialRampToValueAtTime(300, now + dur);
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0, now);
      noiseGain.gain.linearRampToValueAtTime(0.22, now + 0.04);
      noiseGain.gain.exponentialRampToValueAtTime(1e-3, now + dur);
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      const master = ctx.createGain();
      master.gain.value = 0.9;
      rumbleGain.connect(master);
      noiseGain.connect(master);
      master.connect(ctx.destination);
      rumble.start(now);
      rumble.stop(now + dur);
      noise.start(now);
      noise.stop(now + dur);
      setTimeout(() => {
        try {
          ctx.close();
        } catch (e) {
        }
      }, (dur + 0.3) * 1e3);
    } catch (e) {
    }
  }
  const sound = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    isSoundOn,
    playRocketLaunch,
    setSoundOn
  }, Symbol.toStringTag, { value: "Module" }));
  const RevM2Logo = (() => {
    const ICON_MASK_PATH = "M 210 20 C 148 100 170 410 250 485 C 300 430 335 345 360 305 C 385 345 420 430 470 485 C 550 410 572 100 510 20";
    const ICON_PATH_LEN = 1400;
    function buildSVG(size) {
      const full = size === "full";
      const id = "L" + Math.random().toString(36).slice(2, 7);
      if (full) {
        return `<svg class="rm2-svg rm2-svg--full" viewBox="0 0 1187 1145"
          xmlns="http://www.w3.org/2000/svg" role="img" aria-label="WYNKO — Focus · Study · Together">
        <defs>
          <filter id="${id}glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="26" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>
        <image href="wynko-lockup.png" x="0" y="0" width="1187" height="1145"
          filter="url(#${id}glow)" opacity="0" preserveAspectRatio="xMidYMid meet">
          <animate attributeName="opacity" from="0" to="0.5" dur="1.1s" begin="0.15s" fill="freeze"
            calcMode="spline" keySplines="0.3 0 0.15 1"/>
          <animate attributeName="opacity" values="0.5;0.75;0.5" dur="2.6s" begin="1.25s" repeatCount="indefinite"/>
        </image>
        <image href="wynko-lockup.png" x="0" y="0" width="1187" height="1145"
          preserveAspectRatio="xMidYMid meet" opacity="0" transform="scale(0.92)" transform-origin="593.5 572.5">
          <animate attributeName="opacity" from="0" to="1" dur="0.9s" begin="0.1s" fill="freeze"
            calcMode="spline" keySplines="0.2 0 0.15 1"/>
          <animateTransform attributeName="transform" type="scale" additive="replace"
            from="0.92" to="1" dur="0.9s" begin="0.1s" fill="freeze"
            calcMode="spline" keySplines="0.2 0 0.15 1"/>
        </image>
      </svg>`;
      }
      return `<svg class="rm2-svg rm2-svg--${size}" viewBox="0 0 720 570"
        xmlns="http://www.w3.org/2000/svg" role="img" aria-label="WYNKO">
      <defs>
        <mask id="${id}mask" maskUnits="userSpaceOnUse">
          <rect x="0" y="0" width="720" height="570" fill="black"/>
          <path d="${ICON_MASK_PATH}" fill="none" stroke="white"
            stroke-width="168" stroke-linecap="round" stroke-linejoin="round"
            stroke-dasharray="${ICON_PATH_LEN}" stroke-dashoffset="${ICON_PATH_LEN}">
            <animate attributeName="stroke-dashoffset" from="${ICON_PATH_LEN}" to="0"
              dur="1.05s" begin="0.05s" fill="freeze"
              calcMode="spline" keySplines="0.3 0 0.15 1"/>
          </path>
        </mask>
        <filter id="${id}glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="20" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      <!-- ambient glow copy — fades in once the draw-reveal lands, then breathes -->
      <image href="wynko-icon.png" x="0" y="0" width="720" height="570"
        filter="url(#${id}glow)" opacity="0" preserveAspectRatio="xMidYMid meet">
        <animate attributeName="opacity" from="0" to="0.5" dur="0.8s" begin="1.1s" fill="freeze"
          calcMode="spline" keySplines="0.3 0 0.15 1"/>
        <animate attributeName="opacity" values="0.5;0.8;0.5" dur="2.4s" begin="1.9s" repeatCount="indefinite"/>
      </image>

      <!-- the real artwork, revealed by the drawing mask -->
      <image href="wynko-icon.png" x="0" y="0" width="720" height="570"
        mask="url(#${id}mask)" preserveAspectRatio="xMidYMid meet"/>
    </svg>`;
    }
    function injectCSS() {
      if (document.getElementById("rm2-logo-css")) return;
      const s = document.createElement("style");
      s.id = "rm2-logo-css";
      s.textContent = `
      .rm2-logo{display:inline-block;line-height:0;position:relative;}
      .rm2-svg{display:block;}
      .rm2-svg--full{width:min(340px,70vw);height:auto;}
      .rm2-svg--nav{width:56px;height:auto;}
      .rm2-svg--small{width:72px;height:auto;}
    `;
      document.head.appendChild(s);
    }
    function init() {
      injectCSS();
      document.querySelectorAll(".rm2-logo").forEach((el) => {
        if (el.dataset.rm2Ready) return;
        el.dataset.rm2Ready = "1";
        const size = el.dataset.size || "full";
        el.innerHTML = buildSVG(size);
      });
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
    return { init };
  })();
  const logo = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    RevM2Logo
  }, Symbol.toStringTag, { value: "Module" }));
  const RevM2Loader = /* @__PURE__ */ (() => {
    let safetyTimer = null;
    function injectCSS() {
      if (document.getElementById("rm2-loader-css")) return;
      const s = document.createElement("style");
      s.id = "rm2-loader-css";
      s.textContent = `
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
    function ensure() {
      injectCSS();
      let ov = document.getElementById("rm2-loader");
      if (!ov) {
        ov = document.createElement("div");
        ov.id = "rm2-loader";
        ov.innerHTML = `<div class="rm2-loader-inner">
        <div class="rm2-logo" data-size="small" data-noaudio="1"></div>
        <div class="rm2-loader-msg" id="rm2-loader-msg">Loading…</div>
      </div>`;
        document.body.appendChild(ov);
      }
      return ov;
    }
    function show(message) {
      const ov = ensure();
      const msgEl = document.getElementById("rm2-loader-msg");
      if (msgEl) msgEl.textContent = message || "Loading…";
      ov.classList.add("rm2-loader--on");
      window.RevM2Logo.init();
      clearTimeout(safetyTimer);
      safetyTimer = setTimeout(hide, 12e3);
    }
    function hide() {
      const ov = document.getElementById("rm2-loader");
      if (ov) ov.classList.remove("rm2-loader--on");
      clearTimeout(safetyTimer);
    }
    return { show, hide };
  })();
  const loadingOverlay = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    RevM2Loader
  }, Symbol.toStringTag, { value: "Module" }));
  exports._ringAudioCtx = null;
  exports._ringLoopTimer = null;
  function startCallRingtone() {
    stopCallRingtone();
    if (!isSoundOn()) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    exports._ringAudioCtx = new Ctx();
    const ringOnce = () => {
      if (!exports._ringAudioCtx) return;
      const now = exports._ringAudioCtx.currentTime;
      [0, 0.45].forEach((offset) => {
        const osc = exports._ringAudioCtx.createOscillator();
        const gain = exports._ringAudioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = 440;
        gain.gain.setValueAtTime(0, now + offset);
        gain.gain.linearRampToValueAtTime(0.18, now + offset + 0.05);
        gain.gain.linearRampToValueAtTime(0, now + offset + 0.38);
        osc.connect(gain);
        gain.connect(exports._ringAudioCtx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.4);
      });
    };
    ringOnce();
    exports._ringLoopTimer = setInterval(ringOnce, 1600);
  }
  function stopCallRingtone() {
    clearInterval(exports._ringLoopTimer);
    exports._ringLoopTimer = null;
    if (exports._ringAudioCtx) {
      try {
        exports._ringAudioCtx.close();
      } catch (e) {
      }
      exports._ringAudioCtx = null;
    }
  }
  exports._ringNotification = null;
  function notifyIncomingCall(name) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      exports._ringNotification = new Notification("Incoming call", {
        body: `${name || "Someone"} is calling you on RevM²`,
        icon: "icon-192.png",
        tag: "revm2-incoming-call",
        requireInteraction: true
      });
      exports._ringNotification.onclick = () => {
        window.focus();
        exports._ringNotification.close();
      };
    } catch (e) {
    }
  }
  function closeCallNotification() {
    if (exports._ringNotification) {
      exports._ringNotification.close();
      exports._ringNotification = null;
    }
  }
  const callRingtone = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    get _ringAudioCtx() {
      return exports._ringAudioCtx;
    },
    get _ringLoopTimer() {
      return exports._ringLoopTimer;
    },
    get _ringNotification() {
      return exports._ringNotification;
    },
    closeCallNotification,
    notifyIncomingCall,
    startCallRingtone,
    stopCallRingtone
  }, Symbol.toStringTag, { value: "Module" }));
  const RevM2Calls = /* @__PURE__ */ (() => {
    let channel = null, activeToast = null;
    function injectCSS() {
      if (document.getElementById("rm2-call-toast-css")) return;
      const s = document.createElement("style");
      s.id = "rm2-call-toast-css";
      s.textContent = `
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
    function dismiss() {
      if (activeToast) {
        activeToast.remove();
        activeToast = null;
      }
      stopCallRingtone();
      closeCallNotification();
    }
    function showToast(sb2, payload) {
      dismiss();
      injectCSS();
      const name = payload.fromUsername ? "@" + payload.fromUsername : "Someone";
      const el = document.createElement("div");
      el.id = "rm2-call-toast";
      el.innerHTML = `
      <div class="rm2ct-avatar">${payload.fromAvatarUrl ? `<img src="${escHtml(payload.fromAvatarUrl)}">` : (payload.fromUsername || "?").charAt(0).toUpperCase()}</div>
      <div><div class="rm2ct-name">${escHtml(name)}</div><div class="rm2ct-sub">Incoming ${payload.callType === "video" ? "video" : "voice"} call…</div></div>
      <div class="rm2ct-btns">
        <button class="rm2ct-decline" title="Decline">✕</button>
        <button class="rm2ct-accept" title="Accept">${payload.callType === "video" ? "▶" : "📞"}</button>
      </div>`;
      document.body.appendChild(el);
      activeToast = el;
      startCallRingtone();
      notifyIncomingCall(name);
      el.querySelector(".rm2ct-decline").onclick = () => {
        dismiss();
        try {
          const declineCh = sb2.channel(`dm-call-${payload.fid}`);
          declineCh.subscribe((status) => {
            if (status === "SUBSCRIBED") {
              declineCh.send({ type: "broadcast", event: "call", payload: { from: payload.toUserId, to: payload.fromUserId, kind: "decline" } });
              setTimeout(() => sb2.removeChannel(declineCh), 800);
            }
          });
        } catch (e) {
        }
      };
      el.querySelector(".rm2ct-accept").onclick = () => {
        dismiss();
        window.location.href = `chat.html?fid=${payload.fid}&call=${payload.callType}&autoaccept=1`;
      };
    }
    function init(sb2, myUserId) {
      if (channel || !myUserId || !sb2) return;
      channel = sb2.channel(`user-calls-${myUserId}`).on("broadcast", { event: "incoming_call" }, ({ payload }) => {
        if (location.pathname.endsWith("chat.html") && new URLSearchParams(location.search).get("fid") === payload.fid) return;
        showToast(sb2, payload);
      }).subscribe();
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    }
    return { init };
  })();
  const incomingCallToast = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    RevM2Calls
  }, Symbol.toStringTag, { value: "Module" }));
  const RevM2Notifications = /* @__PURE__ */ (() => {
    let channel = null, sbRef = null, myId = null;
    const senderCache = {};
    function badgeEl() {
      return document.getElementById("navPartnersBadge");
    }
    async function refreshCounts() {
      if (!sbRef || !myId) return;
      try {
        const { data } = await sbRef.from("dm_messages").select("kind,call_status").eq("recipient_id", myId).is("read_at", null);
        const rows = data || [];
        const unreadMsgs = rows.filter((r) => r.kind === "text").length;
        const missedCalls = rows.filter((r) => r.kind === "call_log" && r.call_status === "missed").length;
        const total = unreadMsgs + missedCalls;
        const el = badgeEl();
        if (el) {
          el.style.display = total > 0 ? "inline-flex" : "none";
          el.textContent = total > 9 ? "9+" : String(total);
          el.title = `${unreadMsgs} unread message${unreadMsgs === 1 ? "" : "s"} · ${missedCalls} missed call${missedCalls === 1 ? "" : "s"}`;
        }
      } catch (e) {
      }
    }
    async function senderInfo(userId) {
      if (senderCache[userId]) return senderCache[userId];
      try {
        const { data } = await sbRef.from("user_profiles").select("username,avatar_url").eq("id", userId).single();
        senderCache[userId] = data || {};
      } catch (e) {
        senderCache[userId] = {};
      }
      return senderCache[userId];
    }
    function injectCSS() {
      if (document.getElementById("rm2-notify-toast-css")) return;
      const s = document.createElement("style");
      s.id = "rm2-notify-toast-css";
      s.textContent = `
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
    async function showToast(kind, row) {
      var _a;
      injectCSS();
      const existing = document.getElementById("rm2-notify-toast");
      if (existing) existing.remove();
      const sender = await senderInfo(row.sender_id);
      const name = sender.username ? "@" + sender.username : "Someone";
      const sub = kind === "message" ? escHtml((row.body || "").slice(0, 60)) : `Missed ${row.call_type === "video" ? "video" : "voice"} call`;
      const el = document.createElement("div");
      el.id = "rm2-notify-toast";
      el.innerHTML = `
      <div class="rm2nt-avatar">${sender.avatar_url ? `<img src="${escHtml(sender.avatar_url)}">` : ((_a = name.charAt(1)) == null ? void 0 : _a.toUpperCase()) || "?"}</div>
      <div style="min-width:0;"><div class="rm2nt-name">${escHtml(name)}</div><div class="rm2nt-sub">${sub}</div></div>
      <button class="rm2nt-close" title="Dismiss">✕</button>`;
      document.body.appendChild(el);
      el.querySelector(".rm2nt-close").onclick = (e) => {
        e.stopPropagation();
        el.remove();
      };
      el.onclick = () => {
        window.location.href = `chat.html?fid=${row.friendship_id}`;
      };
      setTimeout(() => {
        if (el.parentNode) el.remove();
      }, 8e3);
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          const n = new Notification(kind === "message" ? `${name} messaged you` : `Missed call from ${name}`, {
            body: kind === "message" ? (row.body || "").slice(0, 80) : `You missed a ${row.call_type === "video" ? "video" : "voice"} call`,
            icon: "icon-192.png",
            tag: "revm2-" + kind
          });
          n.onclick = () => {
            window.focus();
            window.location.href = `chat.html?fid=${row.friendship_id}`;
          };
        } catch (e) {
        }
      }
    }
    function init(sb2, myUserId) {
      if (channel || !myUserId || !sb2) return;
      sbRef = sb2;
      myId = myUserId;
      refreshCounts();
      channel = sb2.channel(`user-notify-${myUserId}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_messages", filter: `recipient_id=eq.${myUserId}` }, ({ new: row }) => {
        refreshCounts();
        const onThisChat = location.pathname.endsWith("chat.html") && new URLSearchParams(location.search).get("fid") === row.friendship_id;
        if (onThisChat) return;
        if (row.kind === "text") showToast("message", row);
        else if (row.kind === "call_log" && row.call_status === "missed") showToast("missed_call", row);
      }).on("postgres_changes", { event: "UPDATE", schema: "public", table: "dm_messages", filter: `recipient_id=eq.${myUserId}` }, () => refreshCounts()).subscribe();
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    }
    return { init, refreshCounts };
  })();
  const unreadBadges = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    RevM2Notifications
  }, Symbol.toStringTag, { value: "Module" }));
  function openMobileSidebar() {
    const sb2 = document.querySelector(".sidebar");
    const bd = document.getElementById("sidebarBackdrop");
    if (sb2) sb2.classList.add("mobile-open");
    if (bd) bd.classList.add("active");
    document.body.style.overflow = "hidden";
  }
  function closeMobileSidebar() {
    const sb2 = document.querySelector(".sidebar");
    const bd = document.getElementById("sidebarBackdrop");
    if (sb2) sb2.classList.remove("mobile-open");
    if (bd) bd.classList.remove("active");
    document.body.style.overflow = "";
  }
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".sidebar .nav-item").forEach((el) => {
      el.addEventListener("click", () => {
        if (window.innerWidth <= 768) closeMobileSidebar();
      });
    });
    window.addEventListener("resize", () => {
      var _a;
      if (window.innerWidth > 768) closeMobileSidebar();
      else (_a = document.querySelector(".sidebar")) == null ? void 0 : _a.classList.remove("hover-open");
    });
  });
  const mobileSidebar = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    closeMobileSidebar,
    openMobileSidebar
  }, Symbol.toStringTag, { value: "Module" }));
  function initSidebarHoverReveal() {
    const sidebar = document.querySelector(".sidebar");
    if (!sidebar) return;
    if (document.getElementById("sidebarHoverZone")) return;
    const zone = document.createElement("div");
    zone.id = "sidebarHoverZone";
    zone.className = "sidebar-hover-zone";
    document.body.appendChild(zone);
    let closeTimer = null;
    function reveal() {
      clearTimeout(closeTimer);
      sidebar.classList.add("hover-open");
    }
    function scheduleHide() {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => sidebar.classList.remove("hover-open"), 180);
    }
    zone.addEventListener("mouseenter", reveal);
    sidebar.addEventListener("mouseenter", reveal);
    zone.addEventListener("mouseleave", scheduleHide);
    sidebar.addEventListener("mouseleave", scheduleHide);
  }
  document.addEventListener("DOMContentLoaded", initSidebarHoverReveal);
  const sidebarHover = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    initSidebarHoverReveal
  }, Symbol.toStringTag, { value: "Module" }));
  const RM2_REDUCED_MOTION = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function rm2AnimateNumber(el, target, opts = {}) {
    if (!el) return;
    target = Number(target) || 0;
    if (RM2_REDUCED_MOTION) {
      el.textContent = opts.format ? opts.format(target) : target.toLocaleString();
      return;
    }
    const startVal = parseFloat((el.textContent || "").replace(/[^0-9.-]/g, "")) || 0;
    if (startVal === target) {
      el.textContent = opts.format ? opts.format(target) : target.toLocaleString();
      return;
    }
    const duration = opts.duration || 600;
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    function tick(now) {
      const p = Math.min(1, (now - t0) / duration);
      const val = Math.round(startVal + (target - startVal) * ease(p));
      el.textContent = opts.format ? opts.format(val) : val.toLocaleString();
      if (p < 1) requestAnimationFrame(tick);
      else {
        el.classList.remove("rm2-count-landed");
        void el.offsetWidth;
        el.classList.add("rm2-count-landed");
      }
    }
    requestAnimationFrame(tick);
  }
  function rm2Stagger(nodeList, opts = {}) {
    if (RM2_REDUCED_MOTION) return;
    const step = opts.step ?? 35;
    const cap = opts.cap ?? 10;
    Array.from(nodeList).forEach((el, i) => {
      el.style.setProperty("--d", `${Math.min(i, cap) * step}ms`);
      el.classList.add("rm2-in");
    });
  }
  (function initMobileNativeShell() {
    function isNative() {
      return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());
    }
    const RM2Native = {
      isNative,
      plugin(name) {
        return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name];
      },
      haptic(style) {
        const H = this.plugin("Haptics");
        if (!H) return;
        const map = { light: "LIGHT", medium: "MEDIUM", heavy: "HEAVY" };
        H.impact({ style: map[style] || "LIGHT" }).catch(() => {
        });
      }
    };
    window.RM2Native = RM2Native;
    if (!isNative()) return;
    document.documentElement.classList.add("rm2-native-shell");
    function setupChrome() {
      const StatusBar = RM2Native.plugin("StatusBar");
      if (StatusBar) {
        StatusBar.setBackgroundColor({ color: "#0b0b0f" }).catch(() => {
        });
        StatusBar.setStyle({ style: "DARK" }).catch(() => {
        });
      }
      const Keyboard = RM2Native.plugin("Keyboard");
      if (Keyboard && Keyboard.addListener) {
        Keyboard.addListener("keyboardWillShow", (info) => {
          document.documentElement.style.setProperty("--rm2-kb-height", (info.keyboardHeight || 0) + "px");
          document.documentElement.classList.add("rm2-kb-open");
        });
        Keyboard.addListener("keyboardWillHide", () => {
          document.documentElement.classList.remove("rm2-kb-open");
          document.documentElement.style.setProperty("--rm2-kb-height", "0px");
        });
      }
      const Splash = RM2Native.plugin("SplashScreen");
      if (Splash) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          Splash.hide().catch(() => {
          });
        }));
      }
    }
    const TABS = [
      { key: "tracker", label: "Tracker", href: "tracker.html", icon: "M6 4h12v17H6zM9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M9 11h6M9 15h6" },
      { key: "groups", label: "Groups", href: "groups.html", icon: "M16 21v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V21M9 7.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM17.5 11a3.5 3.5 0 1 0 0-7" },
      { key: "timer", label: "Timer", href: "timer.html", icon: "M7 3h10M7 21h10M8 3c0 4 3 5 4 6.5C13 8 16 7 16 3M8 21c0-4 3-5 4-6.5C13 16 16 17 16 21" },
      { key: "leaderboard", label: "Leaderboard", href: "partners.html", icon: "M4 20V13M12 20V8M20 20v-4M4 11l8-5 8 3" },
      { key: "profile", label: "Profile", href: "onboarding.html", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6" }
    ];
    function currentTabKey() {
      const file = location.pathname.split("/").pop() || "index.html";
      if (file.startsWith("tracker")) return "tracker";
      if (file.startsWith("groups")) return "groups";
      if (file.startsWith("timer")) return "timer";
      if (file.startsWith("partners")) return "leaderboard";
      if (file.startsWith("onboarding") || file.startsWith("login")) return "profile";
      return null;
    }
    function buildTabBar() {
      if (document.getElementById("rm2NativeTabBar")) return;
      if (!document.querySelector(".sidebar")) return;
      const active = currentTabKey();
      const bar = document.createElement("nav");
      bar.id = "rm2NativeTabBar";
      bar.className = "rm2-native-tabbar";
      bar.innerHTML = TABS.map((t) => `
      <a href="${t.href}" class="rm2-tab${t.key === active ? " active" : ""}" data-tab="${t.key}">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${t.icon}"/></svg>
        <span>${t.label}</span>
      </a>`).join("");
      bar.addEventListener("click", (e) => {
        const a = e.target.closest(".rm2-tab");
        if (a) RM2Native.haptic("light");
      });
      document.body.appendChild(bar);
      document.body.classList.add("rm2-has-tabbar");
    }
    function boot() {
      setupChrome();
      buildTabBar();
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  })();
  const animate = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
    __proto__: null,
    RM2_REDUCED_MOTION,
    rm2AnimateNumber,
    rm2Stagger
  }, Symbol.toStringTag, { value: "Module" }));
  const modules = [
    config,
    store,
    format,
    nav,
    auth,
    analytics,
    trackerSync,
    examSwitcher,
    typographyReveal,
    starfield,
    sound,
    logo,
    loadingOverlay,
    callRingtone,
    incomingCallToast,
    unreadBadges,
    mobileSidebar,
    sidebarHover,
    animate
  ];
  for (const mod of modules) {
    for (const [key, value] of Object.entries(mod)) {
      if (key.startsWith("_")) continue;
      window[key] = value;
    }
  }
  exports.EXAM_SWITCH_LIST = EXAM_SWITCH_LIST;
  exports.INTERVALS = INTERVALS;
  exports.REVM2_CONFIG = REVM2_CONFIG;
  exports.RM2_REDUCED_MOTION = RM2_REDUCED_MOTION;
  exports.RevM2Calls = RevM2Calls;
  exports.RevM2Loader = RevM2Loader;
  exports.RevM2Logo = RevM2Logo;
  exports.RevM2Notifications = RevM2Notifications;
  exports.Store = Store;
  exports.TODAY = TODAY;
  exports.TODAY_STR = TODAY_STR;
  exports.autoConnectDesktop = autoConnectDesktop;
  exports.closeCallNotification = closeCallNotification;
  exports.closeMobileSidebar = closeMobileSidebar;
  exports.escAttr = escAttr;
  exports.escHtml = escHtml;
  exports.fmtDateFull = fmtDateFull;
  exports.fmtDateShort = fmtDateShort;
  exports.fmtTime = fmtTime;
  exports.go = go;
  exports.goInvite = goInvite;
  exports.initExamSwitcher = initExamSwitcher;
  exports.initSidebarHoverReveal = initSidebarHoverReveal;
  exports.initStarfield = initStarfield;
  exports.initTypographyReveal = initTypographyReveal;
  exports.isSoundOn = isSoundOn;
  exports.logEvent = logEvent;
  exports.notifyIncomingCall = notifyIncomingCall;
  exports.openExamSwitcher = openExamSwitcher;
  exports.openMobileSidebar = openMobileSidebar;
  exports.pickExamSwitch = pickExamSwitch;
  exports.playRocketLaunch = playRocketLaunch;
  exports.pullConfigFromSupabase = pullConfigFromSupabase;
  exports.pullTrackerFromSupabase = pullTrackerFromSupabase;
  exports.requireAuth = requireAuth;
  exports.rm2AnimateNumber = rm2AnimateNumber;
  exports.rm2RevealHeading = rm2RevealHeading;
  exports.rm2Stagger = rm2Stagger;
  exports.saveExamSwitch = saveExamSwitch;
  exports.setSoundOn = setSoundOn;
  exports.signOutRevM2 = signOutRevM2;
  exports.startCallRingtone = startCallRingtone;
  exports.startDesktopAuthSync = startDesktopAuthSync;
  exports.stopCallRingtone = stopCallRingtone;
  exports.syncNativeAuthToken = syncNativeAuthToken;
  exports.syncTrackerToSupabase = syncTrackerToSupabase;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
  return exports;
}({});
