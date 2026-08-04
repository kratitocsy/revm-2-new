/* materials-viewer.js — page-by-page reader for group materials
 *
 * IMPORTANT CAVEAT (read before relying on this for anything sensitive):
 * everything in here is a *deterrent*, not real DRM. It stops casual
 * right-click-save / drag-out / devtools-network-tab grabs. It cannot stop
 * a screenshot, a phone camera, or a determined user with browser devtools
 * open before the page loads. Signed URLs expire quickly so a saved link
 * goes stale fast, but the decoded pixels are always in the page once
 * rendered — that's true of any web-based viewer, Kindle's web reader
 * included.
 */

const MATERIALS_WORKER_URL_VIEWER = 'https://revm2-materials-proxy.kiaro2244.workers.dev';
const MV_MIN_SCALE = 1;
const MV_MAX_SCALE = 4;

let _mvState = null; // { materialId, pages, index, overlayEl, reqId, scale, tx, ty }

function _mvInjectStyles() {
  if (document.getElementById('mv-styles')) return;
  const style = document.createElement('style');
  style.id = 'mv-styles';
  style.textContent = `
    #mv-overlay { position:fixed; inset:0; background:#000; z-index:9999;
      display:flex; flex-direction:column; align-items:center; justify-content:center; }
    #mv-page-wrap { flex:1; width:100%; display:flex; align-items:center; justify-content:center;
      overflow:hidden; position:relative; touch-action:none; perspective:1800px; }
    #mv-page-img { max-width:100%; max-height:100%; -webkit-touch-callout:none;
      -webkit-user-select:none; user-select:none; will-change:transform;
      transition:transform 0.08s ease-out; }
    #mv-page-img.mv-panning { transition:none; cursor:grabbing; }
    #mv-page-img.mv-zoomed { cursor:grab; }
    /* Kindle-style page-turn: the OUTGOING page is cloned into this layer and
       rotated away about its spine edge (right edge for "next", left edge for
       "prev") while the incoming page — already the real #mv-page-img — sits
       underneath and is revealed as the turning page rotates past. */
    .mv-flip-page { position:absolute; top:0; left:0; width:100%; height:100%;
      object-fit:contain; backface-visibility:hidden; pointer-events:none;
      z-index:5; transform:rotateY(0deg); background:#000; }
    .mv-flip-page.mv-flip-next { transform-origin:right center; }
    .mv-flip-page.mv-flip-prev { transform-origin:left center; }
    .mv-flip-page.mv-flip-animate-next { transition:transform 0.46s cubic-bezier(.45,0,.2,1); transform:rotateY(-160deg); }
    .mv-flip-page.mv-flip-animate-prev { transition:transform 0.46s cubic-bezier(.45,0,.2,1); transform:rotateY(160deg); }
    /* A soft sweeping shadow that tracks the curling edge, the same trick
       Kindle/iBooks use to sell the illusion of a lifting sheet of paper. */
    .mv-flip-shade { position:absolute; top:0; width:60%; height:100%; z-index:6;
      pointer-events:none; opacity:0; transition:opacity 0.46s ease; }
    .mv-flip-shade-next { right:0; background:linear-gradient(to left, rgba(0,0,0,0.5), rgba(0,0,0,0) 100%); }
    .mv-flip-shade-prev { left:0; background:linear-gradient(to right, rgba(0,0,0,0.5), rgba(0,0,0,0) 100%); }
    .mv-flip-shade.mv-flip-shade-on { opacity:1; }
    #mv-tap-prev, #mv-tap-next { position:absolute; top:0; bottom:0; width:35%; cursor:pointer; }
    #mv-tap-prev { left:0; } #mv-tap-next { right:0; }
    #mv-loading { position:absolute; inset:0; display:none; align-items:center; justify-content:center;
      color:#eee; font:13px system-ui,sans-serif; letter-spacing:0.02em; z-index:3; pointer-events:none; }
    #mv-loading.show { display:flex; }
    #mv-bar { display:flex; align-items:center; justify-content:space-between; gap:8px;
      width:100%; padding:10px 16px; box-sizing:border-box; background:#111; color:#eee;
      font:14px system-ui,sans-serif; flex-wrap:wrap; }
    #mv-bar-nav, #mv-bar-zoom, #mv-bar-jump { display:flex; align-items:center; gap:8px; }
    #mv-bar button { background:#222; color:#eee; border:1px solid #444; border-radius:6px;
      padding:6px 12px; cursor:pointer; font-size:13px; }
    #mv-bar button:disabled { opacity:.35; cursor:default; }
    #mv-zoom-pct { min-width:38px; text-align:center; font-size:12px; color:#aaa; }
    #mv-jump-input { width:44px; background:#181818; border:1px solid #444; border-radius:6px;
      color:#eee; padding:5px 6px; font-size:13px; text-align:center; }
    #mv-jump-input::-webkit-inner-spin-button { opacity:0.6; }
    #mv-blank-cover { position:absolute; inset:0; background:#000; z-index:2; display:none; }
    @media (max-width:640px){
      #mv-bar { justify-content:center; padding:8px 10px; }
      #mv-bar-nav { order:1; width:100%; justify-content:space-between; }
      #mv-bar-zoom { order:2; }
      #mv-bar-jump { order:3; }
    }
  `;
  document.head.appendChild(style);
}

async function _mvPageUrl(materialId, pageNumber) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Not signed in.');
  const res = await fetch(`${MATERIALS_WORKER_URL_VIEWER}/mint`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ material_id: materialId, page_number: pageNumber }),
  });
  if (!res.ok) throw new Error('Could not open this page.');
  const { token } = await res.json();
  return `${MATERIALS_WORKER_URL_VIEWER}/view/${token}`;
}

function _mvSetLoading(on) {
  document.getElementById('mv-loading')?.classList.toggle('show', on);
  // Boundary state should reflect the page we're actually heading to (the
  // queued target while busy, otherwise the current index) rather than
  // hard-disabling on every "busy" tick — a disabled button swallows the
  // click event entirely, which is exactly what made taps during a page
  // turn feel like they were being ignored.
  const effectiveIndex = (_mvState.busy && _mvState.pendingIndex !== null) ? _mvState.pendingIndex : _mvState.index;
  document.getElementById('mv-prev-btn').disabled = effectiveIndex === 0;
  document.getElementById('mv-next-btn').disabled = effectiveIndex === _mvState.pages.length - 1;
  document.getElementById('mv-jump-btn').disabled = on;
}

/* Clones the outgoing page on top of the wrap and rotates it away about its
 * spine edge while the incoming page (already sitting in #mv-page-img
 * underneath) is revealed — the classic book/Kindle page-turn illusion.
 * Resolves once the animation is done (or immediately if the browser can't
 * do 3D transforms, via the transitionend safety-net timeout below). */
function _mvPlayPageFlip(oldSrc, direction) {
  return new Promise(resolve => {
    const wrap = document.getElementById('mv-page-wrap');
    if (!wrap || !oldSrc) { resolve(); return; }

    const flip = document.createElement('img');
    flip.src = oldSrc;
    flip.draggable = false;
    flip.alt = '';
    flip.className = 'mv-flip-page ' + (direction === 'next' ? 'mv-flip-next' : 'mv-flip-prev');
    wrap.appendChild(flip);

    const shade = document.createElement('div');
    shade.className = 'mv-flip-shade ' + (direction === 'next' ? 'mv-flip-shade-next' : 'mv-flip-shade-prev');
    wrap.appendChild(shade);

    void flip.offsetWidth; // force a reflow so the transition below actually animates

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      flip.remove();
      shade.remove();
      resolve();
    };

    requestAnimationFrame(() => {
      flip.classList.add(direction === 'next' ? 'mv-flip-animate-next' : 'mv-flip-animate-prev');
      shade.classList.add('mv-flip-shade-on');
      flip.addEventListener('transitionend', finish, { once: true });
    });
    setTimeout(finish, 650); // safety net — never leave the clone stuck on screen
  });
}

/* Guarded against out-of-order responses: if the user taps next/prev
 * (or the tap zones) a couple of times before a fetch resolves, the page
 * indicator used to jump ahead ("2 / 5", "3 / 5"...) while the image
 * stayed on whichever request happened to finish LAST rather than the
 * one that was actually requested last — the image looked "stuck". Every
 * call now stamps a request id AND sets a busy flag so a page turn can't
 * even be kicked off again until the current one (fetch + flip animation)
 * has actually finished.
 *
 * Taps that land while busy are no longer dropped — they're captured in
 * state.pendingIndex and automatically played once the in-flight render
 * finishes (see the drain at the bottom of this function), so a quick
 * flurry of taps doesn't feel "stuck" and only catches up several taps
 * later. */
async function _mvRenderPage(index) {
  const state = _mvState;
  const myReq = ++state.reqId;
  state.busy = true;
  state.pendingIndex = null; // this call supersedes any earlier queued target
  _mvSetLoading(true);

  let url;
  try {
    url = await _mvPageUrl(state.materialId, state.pages[index].page_number);
  } catch (e) {
    console.error(e);
    if (state.reqId === myReq) { state.busy = false; _mvSetLoading(false); }
    return;
  }
  if (state.reqId !== myReq) return; // a newer page request has since started — drop this one

  // Preload the actual image bytes before touching the DOM at all, so the
  // page-turn reveal never uncovers a half-loaded / blank page.
  await new Promise(resolve => {
    const pre = new Image();
    pre.onload = resolve;
    pre.onerror = resolve;
    pre.src = url;
  });
  if (state.reqId !== myReq) return;

  const img = document.getElementById('mv-page-img');
  const direction = index > state.index ? 'next' : 'prev';
  const oldSrc = img.getAttribute('src');
  img.src = url; // new page is the real content, sitting ready underneath the flip clone

  if (oldSrc) await _mvPlayPageFlip(oldSrc, direction);
  if (state.reqId !== myReq) return; // superseded mid-animation — let the newer call take it from here

  state.index = index;
  state.busy = false;
  _mvResetZoom();
  document.getElementById('mv-page-indicator').textContent = `${index + 1} / ${state.pages.length}`;
  document.getElementById('mv-jump-input').value = index + 1;
  _mvSetLoading(false);

  // Drain any navigation that was requested (and queued) while this render
  // was in flight, so taps made mid-animation aren't lost — the viewer
  // catches up to the last-requested page automatically.
  if (state.pendingIndex !== null && state.pendingIndex !== state.index) {
    const next = state.pendingIndex;
    state.pendingIndex = null;
    _mvRenderPage(next);
  }
}

function _mvQueueOrRender(index) {
  const state = _mvState;
  if (!state || index < 0 || index > state.pages.length - 1 || index === state.index) return;
  if (state.busy) { state.pendingIndex = index; return; }
  _mvRenderPage(index);
}

function _mvNext() { if (_mvState) _mvQueueOrRender((_mvState.busy && _mvState.pendingIndex !== null ? _mvState.pendingIndex : _mvState.index) + 1); }
function _mvPrev() { if (_mvState) _mvQueueOrRender((_mvState.busy && _mvState.pendingIndex !== null ? _mvState.pendingIndex : _mvState.index) - 1); }
function _mvJumpTo(pageNum) {
  if (!_mvState) return;
  const idx = Math.min(Math.max(1, pageNum), _mvState.pages.length) - 1;
  _mvQueueOrRender(idx);
}

function _mvKeyHandler(e) {
  if (!_mvState) return;
  if (e.key === 'ArrowRight' || e.key === ' ') _mvNext();
  else if (e.key === 'ArrowLeft') _mvPrev();
  else if (e.key === 'Escape') closeMaterialViewer();
  else if (e.key === '+' || e.key === '=') _mvZoomBy(0.5);
  else if (e.key === '-') _mvZoomBy(-0.5);
}

// Best-effort: blank the page image whenever the tab loses focus/visibility.
// Catches most snipping-tool and alt-tab-to-screen-recorder flows; does NOT
// catch OS-level screenshots that don't shift focus, or a second device.
function _mvVisibilityHandler() {
  const cover = document.getElementById('mv-blank-cover');
  if (!cover) return;
  cover.style.display = document.hidden ? 'block' : 'none';
}

/* ── ZOOM & PAN ──────────────────────────────────────────────
   Desktop: +/- buttons, double-click toggles 1x/2x, scroll wheel zoom
   over the image. Touch: two-finger pinch, double-tap toggles 1x/2x.
   Panning (drag) only kicks in once zoomed past 1x — at 1x the tap
   zones / swipe still just turn pages. */
function _mvApplyTransform() {
  const img = document.getElementById('mv-page-img');
  if (!img) return;
  const { scale, tx, ty } = _mvState;
  img.style.transform = `scale(${scale}) translate(${tx}px, ${ty}px)`;
  img.classList.toggle('mv-zoomed', scale > MV_MIN_SCALE);
  document.getElementById('mv-zoom-pct').textContent = `${Math.round(scale * 100)}%`;
  document.getElementById('mv-zoom-out-btn').disabled = scale <= MV_MIN_SCALE;
  document.getElementById('mv-zoom-in-btn').disabled = scale >= MV_MAX_SCALE;
  // At 1x let taps fall through to the page-turn zones; once zoomed, the
  // image itself handles drag-to-pan so the tap zones step aside.
  document.getElementById('mv-tap-prev').style.pointerEvents = scale > MV_MIN_SCALE ? 'none' : '';
  document.getElementById('mv-tap-next').style.pointerEvents = scale > MV_MIN_SCALE ? 'none' : '';
}

function _mvResetZoom() {
  if (!_mvState) return;
  _mvState.scale = MV_MIN_SCALE;
  _mvState.tx = 0;
  _mvState.ty = 0;
  _mvApplyTransform();
}

function _mvZoomBy(delta, focal) {
  if (!_mvState) return;
  const next = Math.min(MV_MAX_SCALE, Math.max(MV_MIN_SCALE, _mvState.scale + delta));
  if (next === _mvState.scale) return;
  _mvState.scale = next;
  if (next === MV_MIN_SCALE) { _mvState.tx = 0; _mvState.ty = 0; }
  _mvApplyTransform();
}

function _mvClampPan() {
  // Loose clamp so the image can't be dragged wildly off-screen; generous
  // enough to still reach every corner of a zoomed-in page.
  const s = _mvState;
  const wrap = document.getElementById('mv-page-wrap');
  const maxT = (wrap.clientWidth / 2) * (s.scale - 1) / s.scale + 40;
  const maxTy = (wrap.clientHeight / 2) * (s.scale - 1) / s.scale + 40;
  s.tx = Math.min(maxT, Math.max(-maxT, s.tx));
  s.ty = Math.min(maxTy, Math.max(-maxTy, s.ty));
}

function _mvInitZoomPan() {
  const img = document.getElementById('mv-page-img');
  const wrap = document.getElementById('mv-page-wrap');

  // Desktop: mouse drag to pan once zoomed.
  let dragging = false, lastX = 0, lastY = 0;
  img.addEventListener('mousedown', e => {
    if (_mvState.scale <= MV_MIN_SCALE) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    img.classList.add('mv-panning');
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    _mvState.tx += (e.clientX - lastX) / _mvState.scale;
    _mvState.ty += (e.clientY - lastY) / _mvState.scale;
    lastX = e.clientX; lastY = e.clientY;
    _mvClampPan();
    _mvApplyTransform();
  });
  window.addEventListener('mouseup', () => { dragging = false; img.classList.remove('mv-panning'); });

  // Desktop: scroll wheel zoom, and double-click to toggle 1x/2x.
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    _mvZoomBy(e.deltaY < 0 ? 0.35 : -0.35);
  }, { passive: false });
  img.addEventListener('dblclick', () => {
    _mvState.scale > MV_MIN_SCALE ? _mvResetZoom() : _mvZoomBy(1.5);
  });

  // Touch: pinch-to-zoom with two fingers, single-finger drag to pan once
  // zoomed, and a double-tap toggles 1x/2x (mirrors the desktop dblclick).
  let pinchStartDist = 0, pinchStartScale = 1;
  let touchLastX = 0, touchLastY = 0, panningTouch = false;
  let lastTapTime = 0;

  function touchDist(t0, t1) {
    return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
  }

  wrap.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      pinchStartDist = touchDist(e.touches[0], e.touches[1]);
      pinchStartScale = _mvState.scale;
      panningTouch = false;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapTime < 300) { // double-tap
        _mvState.scale > MV_MIN_SCALE ? _mvResetZoom() : _mvZoomBy(1.5);
      }
      lastTapTime = now;
      if (_mvState.scale > MV_MIN_SCALE) {
        panningTouch = true;
        touchLastX = e.touches[0].clientX;
        touchLastY = e.touches[0].clientY;
      }
    }
  }, { passive: true });

  wrap.addEventListener('touchmove', e => {
    if (e.touches.length === 2 && pinchStartDist > 0) {
      e.preventDefault();
      const dist = touchDist(e.touches[0], e.touches[1]);
      const scale = Math.min(MV_MAX_SCALE, Math.max(MV_MIN_SCALE, pinchStartScale * (dist / pinchStartDist)));
      _mvState.scale = scale;
      if (scale === MV_MIN_SCALE) { _mvState.tx = 0; _mvState.ty = 0; }
      _mvApplyTransform();
    } else if (panningTouch && e.touches.length === 1) {
      e.preventDefault();
      const t = e.touches[0];
      _mvState.tx += (t.clientX - touchLastX) / _mvState.scale;
      _mvState.ty += (t.clientY - touchLastY) / _mvState.scale;
      touchLastX = t.clientX; touchLastY = t.clientY;
      _mvClampPan();
      _mvApplyTransform();
    }
  }, { passive: false });

  wrap.addEventListener('touchend', e => {
    if (e.touches.length < 2) pinchStartDist = 0;
    if (e.touches.length === 0) panningTouch = false;
  });
}

/**
 * Open the reader for a material. `materialId` must already be visible to
 * the current user under RLS (i.e. they're a member of its group).
 */
async function openMaterialViewer(materialId) {
  _mvInjectStyles();
  const { data: pages, error } = await sb.from('group_material_pages')
    .select('page_number')
    .eq('material_id', materialId)
    .order('page_number', { ascending: true });
  if (error) throw error;
  if (!pages || !pages.length) throw new Error('This material has no pages.');

  const overlay = document.createElement('div');
  overlay.id = 'mv-overlay';
  overlay.innerHTML = `
    <div id="mv-page-wrap">
      <img id="mv-page-img" draggable="false" alt="Material page">
      <div id="mv-tap-prev"></div>
      <div id="mv-tap-next"></div>
      <div id="mv-loading">Loading…</div>
      <div id="mv-blank-cover"></div>
    </div>
    <div id="mv-bar">
      <div id="mv-bar-nav">
        <button id="mv-prev-btn">‹ Prev</button>
        <span id="mv-page-indicator"></span>
        <button id="mv-next-btn">Next ›</button>
      </div>
      <div id="mv-bar-zoom">
        <button id="mv-zoom-out-btn" title="Zoom out">−</button>
        <span id="mv-zoom-pct">100%</span>
        <button id="mv-zoom-in-btn" title="Zoom in">+</button>
      </div>
      <div id="mv-bar-jump">
        <input id="mv-jump-input" type="number" min="1" title="Jump to page">
        <button id="mv-jump-btn">Go</button>
      </div>
      <button id="mv-close-btn">Close</button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('contextmenu', e => e.preventDefault());
  overlay.addEventListener('dragstart', e => e.preventDefault());
  overlay.addEventListener('selectstart', e => e.preventDefault());
  document.getElementById('mv-tap-prev').addEventListener('click', _mvPrev);
  document.getElementById('mv-tap-next').addEventListener('click', _mvNext);
  document.getElementById('mv-prev-btn').addEventListener('click', _mvPrev);
  document.getElementById('mv-next-btn').addEventListener('click', _mvNext);
  document.getElementById('mv-zoom-in-btn').addEventListener('click', () => _mvZoomBy(0.5));
  document.getElementById('mv-zoom-out-btn').addEventListener('click', () => _mvZoomBy(-0.5));
  document.getElementById('mv-jump-btn').addEventListener('click', () => {
    _mvJumpTo(parseInt(document.getElementById('mv-jump-input').value, 10) || 1);
  });
  document.getElementById('mv-jump-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('mv-jump-btn').click(); }
  });
  document.getElementById('mv-close-btn').addEventListener('click', closeMaterialViewer);
  document.addEventListener('keydown', _mvKeyHandler);
  document.addEventListener('visibilitychange', _mvVisibilityHandler);
  window.addEventListener('blur', _mvVisibilityHandler);
  window.addEventListener('focus', _mvVisibilityHandler);

  _mvState = { materialId, pages, index: 0, overlayEl: overlay, reqId: 0, busy: false, pendingIndex: null, scale: 1, tx: 0, ty: 0 };
  document.getElementById('mv-jump-input').max = pages.length;
  _mvInitZoomPan();
  await _mvRenderPage(0);
}

function closeMaterialViewer() {
  if (!_mvState) return;
  _mvState.overlayEl.remove();
  document.removeEventListener('keydown', _mvKeyHandler);
  document.removeEventListener('visibilitychange', _mvVisibilityHandler);
  window.removeEventListener('blur', _mvVisibilityHandler);
  window.removeEventListener('focus', _mvVisibilityHandler);
  _mvState = null;
}

window.RevmMaterialsViewer = { openMaterialViewer, closeMaterialViewer };
