/* ── ANIMATED WYNKO LOGO ─────────────────────────────────────
   Draws the REAL logo artwork (wynko-icon.png / wynko-lockup.png)
   on screen rather than approximating it in hand-built vector shapes —
   a wide stroke path traces the W ribbon's flow and is used purely as
   an SVG mask, so what actually reveals is the true gradient/glow
   artwork, not a redrawn copy of it. After the reveal finishes, the
   mark settles into a soft looping glow ("breathing") so it reads as
   alive on loading screens rather than a static image.
   Kept the old RevM2Logo export name + .rm2-logo/.rm2-svg/--size
   classes so every existing call site (RevM2Loader, login.css, etc.)
   keeps working without any other file needing to change. */
export const RevM2Logo = (()=>{
  // Guide stroke traced against the real 720×570 wynko-icon.png so the
  // reveal mask fully covers the ribbon (including the rounded sparkle
  // and graduation-cap terminals) with a little margin to spare — see
  // the mask_check* renders used to tune these control points.
  const ICON_MASK_PATH = 'M 210 20 C 148 100 170 410 250 485 C 300 430 335 345 360 305 C 385 345 420 430 470 485 C 550 410 572 100 510 20';
  const ICON_PATH_LEN = 1400; // >= measured length (~1396), safe dasharray

  function buildSVG(size){
    const full = size==='full';
    const id = 'L'+Math.random().toString(36).slice(2,7);

    if(full){
      // Full lockup (icon + WYNKO wordmark + tagline) is only ever shown
      // large — a clean scale/fade/glow entrance reads better here than
      // a stroke-reveal, which would fight with the wordmark's own
      // letterforms. Currently unused in the app (no page instantiates
      // size="full" yet) but kept ready for a future splash/login hero.
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

    // small / nav — the icon-only mark, drawn on screen stroke-first via
    // an animated mask over the real PNG, then a looping glow once landed.
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

  function injectCSS(){
    if(document.getElementById('rm2-logo-css')) return;
    const s=document.createElement('style');
    s.id='rm2-logo-css';
    s.textContent=`
      .rm2-logo{display:inline-block;line-height:0;position:relative;}
      .rm2-svg{display:block;}
      .rm2-svg--full{width:min(340px,70vw);height:auto;}
      .rm2-svg--nav{width:56px;height:auto;}
      .rm2-svg--small{width:72px;height:auto;}
    `;
    document.head.appendChild(s);
  }

  function init(){
    injectCSS();
    document.querySelectorAll('.rm2-logo').forEach(el=>{
      if(el.dataset.rm2Ready) return; // idempotent — never re-render an already-hydrated logo
      el.dataset.rm2Ready='1';
      const size = el.dataset.size||'full';
      el.innerHTML=buildSVG(size);
    });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
  return {init};
})();
