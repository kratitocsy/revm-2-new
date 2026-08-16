/* ── STARFIELD ───────────────────────────────────────────── */
export function initStarfield(canvasId='starfield', count=240) {
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

