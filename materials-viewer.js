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

let _mvState = null; // { materialId, pages: [{page_number}], index, overlayEl }

function _mvInjectStyles() {
  if (document.getElementById('mv-styles')) return;
  const style = document.createElement('style');
  style.id = 'mv-styles';
  style.textContent = `
    #mv-overlay { position:fixed; inset:0; background:#000; z-index:9999;
      display:flex; flex-direction:column; align-items:center; justify-content:center; }
    #mv-page-wrap { flex:1; width:100%; display:flex; align-items:center; justify-content:center;
      overflow:hidden; position:relative; }
    #mv-page-img { max-width:100%; max-height:100%; -webkit-touch-callout:none;
      -webkit-user-select:none; user-select:none; pointer-events:none; }
    #mv-tap-prev, #mv-tap-next { position:absolute; top:0; bottom:0; width:35%; cursor:pointer; }
    #mv-tap-prev { left:0; } #mv-tap-next { right:0; }
    #mv-bar { display:flex; align-items:center; justify-content:space-between; gap:12px;
      width:100%; padding:10px 16px; box-sizing:border-box; background:#111; color:#eee;
      font:14px system-ui,sans-serif; }
    #mv-bar button { background:#222; color:#eee; border:1px solid #444; border-radius:6px;
      padding:6px 12px; cursor:pointer; }
    #mv-bar button:disabled { opacity:.35; cursor:default; }
    #mv-blank-cover { position:absolute; inset:0; background:#000; z-index:2; display:none; }
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

async function _mvRenderPage(index) {
  const { pages, materialId } = _mvState;
  const img = document.getElementById('mv-page-img');
  const url = await _mvPageUrl(materialId, pages[index].page_number);
  img.src = url;
  _mvState.index = index;
  document.getElementById('mv-page-indicator').textContent = `${index + 1} / ${pages.length}`;
  document.getElementById('mv-prev-btn').disabled = index === 0;
  document.getElementById('mv-next-btn').disabled = index === pages.length - 1;
}

function _mvNext() { if (_mvState.index < _mvState.pages.length - 1) _mvRenderPage(_mvState.index + 1); }
function _mvPrev() { if (_mvState.index > 0) _mvRenderPage(_mvState.index - 1); }

function _mvKeyHandler(e) {
  if (!_mvState) return;
  if (e.key === 'ArrowRight' || e.key === ' ') _mvNext();
  else if (e.key === 'ArrowLeft') _mvPrev();
  else if (e.key === 'Escape') closeMaterialViewer();
}

// Best-effort: blank the page image whenever the tab loses focus/visibility.
// Catches most snipping-tool and alt-tab-to-screen-recorder flows; does NOT
// catch OS-level screenshots that don't shift focus, or a second device.
function _mvVisibilityHandler() {
  const cover = document.getElementById('mv-blank-cover');
  if (!cover) return;
  cover.style.display = document.hidden ? 'block' : 'none';
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
      <div id="mv-blank-cover"></div>
    </div>
    <div id="mv-bar">
      <button id="mv-prev-btn">‹ Prev</button>
      <span id="mv-page-indicator"></span>
      <button id="mv-next-btn">Next ›</button>
      <button id="mv-close-btn" style="margin-left:auto;">Close</button>
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
  document.getElementById('mv-close-btn').addEventListener('click', closeMaterialViewer);
  document.addEventListener('keydown', _mvKeyHandler);
  document.addEventListener('visibilitychange', _mvVisibilityHandler);
  window.addEventListener('blur', _mvVisibilityHandler);
  window.addEventListener('focus', _mvVisibilityHandler);

  _mvState = { materialId, pages, index: 0, overlayEl: overlay };
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
