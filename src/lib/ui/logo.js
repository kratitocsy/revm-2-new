import { isSoundOn, playRocketLaunch, setSoundOn } from './sound.js';
/* ── ANIMATED LOGO ───────────────────────────────────────── */
export const RevM2Logo = (()=>{
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

