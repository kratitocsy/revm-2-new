import { RevM2Logo } from '../Logo/Logo.js';
/* ── GLOBAL LOADING OVERLAY ──────────────────────────────────
   A full-page overlay that shows the animated RevM² logo (small,
   silent) any time the app is buffering: initial auth check, a
   page's first data fetch, or a slow action. Include shared.js,
   then call RevM2Loader.show() as early as possible (before any
   await) and RevM2Loader.hide() once the page has real content.
   Safe to call show()/hide() many times; hide() is a no-op if
   never shown. Auto-hides after 12s as a safety net so a stalled
   fetch never leaves the whole page stuck behind the overlay. */
export const RevM2Loader = (()=>{
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

