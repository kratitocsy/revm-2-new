import { escHtml } from '../core/format.js';
/* ── TYPOGRAPHY REVEAL ────────────────────────────────────── */
/* Soft staggered word-by-word reveal for page headings (.topbar-title),
   paired with the display serif set in style.css. Auto-applies on every
   page that has a .topbar-title — no per-page markup needed. Re-runs
   automatically if a page swaps the heading text at runtime (tracker.html
   changes it when switching tabs), via MutationObserver. Skipped entirely
   for prefers-reduced-motion (CSS also hard-disables the animation as a
   second guard, in case this runs before that media query is evaluated). */
export function rm2RevealHeading(el){
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

export function initTypographyReveal(){
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

