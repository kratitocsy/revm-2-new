/* ============================================================
   RevM² — floating-timer.js  (Phase 2)
   Drop-in floating timer widget for every page. Writes live
   session state to `study_sessions` so groups.html's avatar
   glow / B&W presence indicators have something real to read.

   USAGE: include AFTER shared.js and AFTER the page's own
   `const sb = window.supabase.createClient(...)` line, then call:
       initFloatingTimer();
   (If no auth session exists yet, it no-ops until one does —
   safe to include even on login.html / privacy.html.)

   TIMER INTEGRITY (see migration 0008): start/pause/resume/stop
   all go through SECURITY DEFINER RPCs that stamp time with the
   database's own `now()`. The client can no longer write
   started_at/paused_at/ended_at/total_seconds directly — RLS on
   study_sessions only grants SELECT to the owner. total_seconds
   shown here locally is just for the live ticking display; the
   authoritative value is computed server-side in the RPCs and in
   close-study-day.
   ============================================================ */

(function () {
  const ACTIVE_KEY = 'revm2_active_session';   // {id, group_id, subject, started_at, paused_at, accumPaused}
  let widgetSb = null;
  let tickHandle = null;

  function getSb() {
    if (widgetSb) return widgetSb;
    if (typeof sb !== 'undefined') { widgetSb = sb; return widgetSb; } // reuse page's client if present
    widgetSb = window.supabase.createClient(REVM2_CONFIG.SUPABASE_URL, REVM2_CONFIG.SUPABASE_ANON);
    return widgetSb;
  }

  function injectStyles() {
    if (document.getElementById('ft-styles')) return;
    const css = `
    #ft-widget{position:fixed;bottom:1.25rem;right:1.25rem;z-index:9999;
      background:var(--s1);border:1px solid var(--border2);
      box-shadow:0 4px 24px rgba(0,0,0,0.5);font-family:var(--font);
      padding:0.7rem 0.85rem;min-width:200px;color:var(--text);}
    #ft-widget.live{border-color:var(--gold);}
    #ft-widget .ft-row{display:flex;align-items:center;justify-content:space-between;gap:0.5rem;}
    #ft-widget .ft-time{font-size:1.1rem;font-weight:700;color:var(--gold);font-variant-numeric:tabular-nums;}
    #ft-widget select{background:var(--black);border:1px solid var(--border2);color:var(--text);
      font-family:var(--font);font-size:0.7rem;padding:0.3rem;width:100%;margin-top:0.4rem;}
    #ft-widget .ft-btns{display:flex;gap:0.4rem;margin-top:0.5rem;}
    #ft-widget button{flex:1;background:none;border:1px solid var(--border2);color:var(--muted);
      font-family:var(--font);font-size:0.65rem;letter-spacing:0.04em;text-transform:uppercase;
      padding:0.35rem 0;cursor:pointer;}
    #ft-widget button:hover{border-color:var(--gold);color:var(--gold);}
    #ft-widget button.ft-stop:hover{border-color:var(--danger);color:var(--danger);}
    #ft-widget .ft-paused-tag{font-size:0.6rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;}
    `;
    const style = document.createElement('style');
    style.id = 'ft-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function fmtElapsed(secs) {
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.floor(secs % 60);
    return h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
      : `${m}:${String(s).padStart(2,'0')}`;
  }

  function elapsedSeconds(state) {
    if (!state) return 0;
    const now = Date.now();
    const startedMs = new Date(state.started_at).getTime();
    let paused = state.accumPaused || 0;
    if (state.paused_at) paused += (now - new Date(state.paused_at).getTime());
    const live = state.paused_at ? new Date(state.paused_at).getTime() : now;
    return Math.max(0, Math.floor((live - startedMs - paused) / 1000));
  }

  async function fetchUserGroups() {
    try {
      const { data: { session } } = await getSb().auth.getSession();
      if (!session) return [];
      const { data } = await getSb().from('group_members')
        .select('group_id, study_groups(name)')
        .eq('user_id', session.user.id);
      return (data || []).map(r => ({ id: r.group_id, name: r.study_groups?.name || 'Group' }));
    } catch (e) { return []; }
  }

  function render(state, groups) {
    let el = document.getElementById('ft-widget');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ft-widget';
      document.body.appendChild(el);
    }
    el.classList.toggle('live', !!state && !state.paused_at);

    if (!state) {
      el.innerHTML = `
        <div class="ft-row"><span class="ft-time">00:00</span></div>
        <select id="ft-group"><option value="">Solo (no group)</option>
          ${groups.map(g => `<option value="${g.id}">${escHtml(g.name)}</option>`).join('')}
        </select>
        <select id="ft-subject">
          <option value="Physics">Physics</option><option value="Chemistry">Chemistry</option>
          <option value="Maths">Maths</option><option value="Other">Other</option>
        </select>
        <div class="ft-btns"><button id="ft-start">Start</button></div>`;
      document.getElementById('ft-start').onclick = startSession;
      return;
    }

    const secs = elapsedSeconds(state);
    el.innerHTML = `
      <div class="ft-row">
        <span class="ft-time">${fmtElapsed(secs)}</span>
        ${state.paused_at ? '<span class="ft-paused-tag">paused</span>' : ''}
      </div>
      <div class="ft-btns">
        ${state.paused_at
          ? '<button id="ft-resume">Resume</button>'
          : '<button id="ft-pause">Pause</button>'}
        <button id="ft-stop" class="ft-stop">Stop</button>
      </div>`;
    if (state.paused_at) document.getElementById('ft-resume').onclick = resumeSession;
    else document.getElementById('ft-pause').onclick = pauseSession;
    document.getElementById('ft-stop').onclick = stopSession;
  }

  async function startSession() {
    const { data: { session } } = await getSb().auth.getSession();
    if (!session) return;
    const groupSel = document.getElementById('ft-group');
    const subjSel = document.getElementById('ft-subject');
    const group_id = groupSel && groupSel.value ? groupSel.value : null;
    const subject = subjSel ? subjSel.value : null;

    const { data, error } = await getSb().rpc('rpc_start_study_session', {
      p_group_id: group_id, p_subject: subject
    });
    if (error) { console.error('start session failed', error); alert(error.message || 'Could not start session.'); return; }

    const state = { id: data.id, group_id: data.group_id, subject: data.subject, started_at: data.started_at, paused_at: null, accumPaused: 0 };
    Store.set(ACTIVE_KEY, state);
    startTicking();
  }

  async function pauseSession() {
    const state = Store.get(ACTIVE_KEY);
    if (!state) return;
    const { data, error } = await getSb().rpc('rpc_pause_study_session', { p_session_id: state.id });
    if (error) { console.error('pause failed', error); return; }
    state.paused_at = data.paused_at;
    Store.set(ACTIVE_KEY, state);
    render(state, []);
  }

  async function resumeSession() {
    const state = Store.get(ACTIVE_KEY);
    if (!state || !state.paused_at) return;
    const { data, error } = await getSb().rpc('rpc_resume_study_session', { p_session_id: state.id });
    if (error) { console.error('resume failed', error); return; }
    state.paused_at = null;
    state.accumPaused = data.accumulated_paused_seconds;
    Store.set(ACTIVE_KEY, state);
    startTicking();
  }

  async function stopSession() {
    const state = Store.get(ACTIVE_KEY);
    if (!state) return;
    const { error } = await getSb().rpc('rpc_stop_study_session', { p_session_id: state.id });
    if (error) console.error('stop failed', error); // still clear local state either way
    Store.del(ACTIVE_KEY);
    stopTicking();
    const groups = await fetchUserGroups();
    render(null, groups);
  }

  function startTicking() {
    stopTicking();
    tickHandle = setInterval(() => {
      const state = Store.get(ACTIVE_KEY);
      if (!state) { stopTicking(); return; }
      render(state, []);
    }, 1000);
  }
  function stopTicking() { if (tickHandle) clearInterval(tickHandle); tickHandle = null; }

  async function initFloatingTimer() {
    injectStyles();
    const { data: { session } } = await getSb().auth.getSession().catch(() => ({ data: { session: null } }));
    if (!session) return; // not logged in, e.g. login.html — stay silent
    const state = Store.get(ACTIVE_KEY);
    const groups = state ? [] : await fetchUserGroups();
    render(state, groups);
    if (state && !state.paused_at) startTicking();
  }

  window.initFloatingTimer = initFloatingTimer;
})();
