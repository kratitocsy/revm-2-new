/* ============================================================
   RevM² — brain3d.js  v4
   Image brain + canvas lightning.
   • Auto slow-rotate (CSS perspective trick on image)
   • Scroll → rotate Y + zoom in
   • Mouse hover over container → tilt toward cursor
   • Touch drag → manual rotate
   • Thunderbolts fire between chapter nodes continuously
   • On hover/touch over brain → burst fire all nearby nodes
   ============================================================ */

(function () {
  'use strict';

  const SUBJECT_COLORS = {
    Physics:   { css: '#00d4ff' },
    Chemistry: { css: '#39ff14' },
    Maths:     { css: '#ff8c00' },
    Biology:   { css: '#bf5fff' },
    Default:   { css: '#ffd700' },
  };

  const CHAPTER_POOL = {
    Physics:   ['Kinematics','Laws of Motion','Work & Energy','Rotational Motion','Gravitation','SHM','Waves','Thermodynamics','Electrostatics','Current Electricity','Magnetism','EMI','Optics','Modern Physics','Semiconductors','Fluid Mechanics'],
    Chemistry: ['Mole Concept','Atomic Structure','Chemical Bonding','Thermodynamics','Equilibrium','Redox','Electrochemistry','Organic Reactions','Hydrocarbons','Aldehydes & Ketones','Amines','Polymers','p-Block Elements','d-Block Elements','Solutions'],
    Maths:     ['Limits & Continuity','Differentiation','Integration','Differential Eq','Matrices & Det','Probability','Permutation','Complex Numbers','Vectors','3D Geometry','Conic Sections','Sequences & Series','Trigonometry','Statistics','Binomial Theorem'],
    Biology:   ['Cell Biology','Genetics','Evolution','Human Physiology','Plant Physiology','Ecology','Reproduction','Biotechnology','Biomolecules','Animal Kingdom','Plant Kingdom','Microbes']
  };

  function randomChapters(n) {
    const subjects = Object.keys(CHAPTER_POOL), out = [];
    while (out.length < n) {
      const sub  = subjects[Math.floor(Math.random() * subjects.length)];
      const pool = CHAPTER_POOL[sub];
      const ch   = pool[Math.floor(Math.random() * pool.length)];
      if (!out.find(x => x.name === ch)) out.push({ name: ch, subject: sub });
    }
    return out;
  }

  /* Node positions on the brain surface (fraction of container w/h) */
  const NODE_POSITIONS = [
    { x:0.52,y:0.13 },{ x:0.64,y:0.09 },{ x:0.76,y:0.11 },
    { x:0.88,y:0.18 },{ x:0.96,y:0.30 },{ x:0.98,y:0.44 },
    { x:0.95,y:0.57 },{ x:0.88,y:0.68 },{ x:0.77,y:0.75 },
    { x:0.64,y:0.78 },{ x:0.53,y:0.72 },{ x:0.45,y:0.60 },
    { x:0.43,y:0.47 },{ x:0.47,y:0.34 },{ x:0.57,y:0.24 },
    { x:0.70,y:0.20 },{ x:0.82,y:0.33 },{ x:0.78,y:0.50 },
    { x:0.65,y:0.55 },{ x:0.60,y:0.40 },
  ];

  /* Connections between nodes */
  const CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],
    [9,10],[10,11],[11,12],[12,13],[13,14],[14,15],[15,16],
    [16,17],[17,18],[18,19],[19,13],[15,2],[16,3],[17,5],
    [18,9],[0,14],[1,15],[2,16],[3,17],[6,9],[7,10],
    [11,14],[12,0],[19,15],[18,11],[17,12],
  ];

  window.BrainViz = {
    mount(target, opts = {}) {
      const container = typeof target === 'string'
        ? document.querySelector(target) : target;
      if (!container) return null;

      container.style.position = 'relative';
      container.style.overflow = 'hidden';

      /* ── Wrapper that gets CSS transform (rotate/zoom) ── */
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        position:absolute;inset:0;
        transform-origin:center center;
        transform:perspective(900px) rotateY(0deg) scale(1);
        transition:transform 0.08s linear;
        will-change:transform;
      `;
      container.appendChild(wrapper);

      /* ── Brain image ── */
      const img = document.createElement('img');
      img.src = 'brain-hero.png';
      img.alt = '';
      img.draggable = false;
      img.style.cssText = `
        position:absolute;inset:0;
        width:100%;height:100%;
        object-fit:cover;object-position:left center;
        z-index:1;pointer-events:none;user-select:none;
        display:block;
      `;
      wrapper.appendChild(img);

      /* ── Synapse canvas ── */
      const canvas = document.createElement('canvas');
      canvas.style.cssText = `
        position:absolute;inset:0;width:100%;height:100%;
        z-index:2;pointer-events:none;
      `;
      wrapper.appendChild(canvas);
      const ctx = canvas.getContext('2d');

      /* ── Label overlay (outside wrapper so labels don't distort) ── */
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0;z-index:10;pointer-events:none;overflow:hidden;';
      container.appendChild(overlay);

      /* ── Chapters & labels ── */
      const N = NODE_POSITIONS.length;
      const chapters = randomChapters(N);
      const labels = chapters.map((ch, i) => {
        const sc = SUBJECT_COLORS[ch.subject] || SUBJECT_COLORS.Default;
        const el = document.createElement('div');
        el.innerHTML = `<div style="
          background:rgba(4,6,12,0.93);
          border:1px solid ${sc.css}55;
          border-left:2.5px solid ${sc.css};
          padding:0.28rem 0.65rem 0.32rem;
          border-radius:0 3px 3px 0;
          line-height:1.3;
          box-shadow:0 0 18px ${sc.css}22;
        ">
          <div style="color:${sc.css};font-size:0.52rem;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:0.08rem;font-family:Inter,Arial,sans-serif;">${ch.subject}</div>
          <div style="color:#fff;font-size:0.74rem;font-weight:700;font-family:Inter,Arial,sans-serif;">${ch.name}</div>
        </div>`;
        el.style.cssText = `
          position:absolute;opacity:0;white-space:nowrap;
          pointer-events:none;
          transform:translate(-50%,-50%) scale(0.82) translateY(6px);
          transition:opacity 0.32s ease,transform 0.32s cubic-bezier(0.34,1.56,0.64,1);
          filter:drop-shadow(0 0 10px ${sc.css}44);
        `;
        overlay.appendChild(el);
        return { el, sc };
      });

      /* ── Resize ── */
      function resize() {
        canvas.width  = container.clientWidth;
        canvas.height = container.clientHeight;
      }
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(container);

      /* ── State ── */
      // Transform state
      let rotY      = 0;   // degrees, auto-rotate accumulates here
      let tiltX     = 0;   // mouse tilt X (degrees)
      let tiltY     = 0;   // mouse tilt Y (degrees)
      let scale     = 1.0;
      let scrollProg= 0;   // 0→1 as user scrolls one viewport

      // Touch drag
      let touchStartX = 0, touchStartRotY = 0, isDragging = false;

      // Synapse state
      const sparks      = [];
      const nodeGlow    = new Array(N).fill(0);
      const nodeFiring  = new Array(N).fill(false);
      let labelTimeout  = [];

      /* ── Show a label briefly ── */
      function showLabel(i) {
        const W = canvas.width, H = canvas.height;
        const p = NODE_POSITIONS[i];
        const lbl = labels[i];
        lbl.el.style.left = (p.x * W) + 'px';
        lbl.el.style.top  = (p.y * H) + 'px';
        lbl.el.style.opacity = '1';
        lbl.el.style.transform = 'translate(-50%,-50%) scale(1) translateY(0)';
        clearTimeout(labelTimeout[i]);
        labelTimeout[i] = setTimeout(() => {
          lbl.el.style.opacity = '0';
          lbl.el.style.transform = 'translate(-50%,-50%) scale(0.85) translateY(4px)';
        }, 2400);
      }

      /* ── Fire a single node: glow + shoot sparks ── */
      function fireNode(i, burst = false) {
        if (nodeFiring[i]) return;
        nodeFiring[i] = true;
        nodeGlow[i]   = 1.0;
        showLabel(i);

        const edgesToFire = CONNECTIONS
          .filter(c => c[0] === i || c[1] === i)
          .slice(0, burst ? 6 : 3);

        edgesToFire.forEach(c => {
          const to = c[0] === i ? c[1] : c[0];
          sparks.push({
            from: i, to,
            t: 0,
            speed: burst
              ? (0.028 + Math.random() * 0.018)
              : (0.016 + Math.random() * 0.012),
            triggered: false
          });
        });

        setTimeout(() => { nodeFiring[i] = false; }, burst ? 400 : 700);
      }

      /* ── Auto fire sequence ── */
      let fireQueue = [...Array(N).keys()].sort(() => Math.random() - 0.5);
      let fireIdx   = 0, lastFire = 0;
      const FIRE_MS = 720;

      /* ── Burst on hover / touch ── */
      let lastBurst = 0;
      function burst(cx, cy) {
        const now = Date.now();
        if (now - lastBurst < 600) return;
        lastBurst = now;
        const W = canvas.width, H = canvas.height;
        // Find 3 closest nodes to pointer
        const dists = NODE_POSITIONS.map((p, i) => ({
          i, d: Math.hypot(p.x * W - cx, p.y * H - cy)
        })).sort((a, b) => a.d - b.d);
        dists.slice(0, 3).forEach(({ i }) => fireNode(i, true));
      }

      /* ── Mouse events ── */
      container.addEventListener('mousemove', e => {
        const r  = container.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        const W  = r.width, H = r.height;
        // Tilt: ±12° based on mouse position relative to centre
        tiltY = ((mx / W) - 0.5) * 24;
        tiltX = -((my / H) - 0.5) * 14;
        burst(mx, my);
      });
      container.addEventListener('mouseleave', () => {
        tiltX = 0; tiltY = 0;
      });

      /* ── Touch events ── */
      container.addEventListener('touchstart', e => {
        const t = e.touches[0];
        touchStartX   = t.clientX;
        touchStartRotY = rotY;
        isDragging    = true;
        const r = container.getBoundingClientRect();
        burst(t.clientX - r.left, t.clientY - r.top);
      }, { passive: true });

      container.addEventListener('touchmove', e => {
        if (!isDragging) return;
        const t   = e.touches[0];
        const dx  = t.clientX - touchStartX;
        rotY      = touchStartRotY + dx * 0.35;  // drag sensitivity
        const r   = container.getBoundingClientRect();
        burst(t.clientX - r.left, t.clientY - r.top);
      }, { passive: true });

      container.addEventListener('touchend', () => { isDragging = false; });

      /* ── Scroll ── */
      function onScroll() {
        const sy = window.scrollY, vh = window.innerHeight;
        scrollProg = Math.min(1, sy / vh);
        // Scroll rotates brain & zooms in
        scale = 1.0 + scrollProg * 0.32;
      }
      window.addEventListener('scroll', onScroll, { passive: true });

      /* ── Apply CSS transform to wrapper ── */
      let autoAngle = 0;
      function applyTransform() {
        const totalRotY = rotY + tiltY + autoAngle + scrollProg * 35;
        const totalRotX = tiltX - scrollProg * 8;
        wrapper.style.transform = `
          perspective(900px)
          rotateX(${totalRotX}deg)
          rotateY(${totalRotY}deg)
          scale(${scale})
        `;
      }

      /* ── Lightning bolt ── */
      function drawLightning(x1, y1, x2, y2, progress, alpha) {
        if (progress <= 0 || alpha <= 0) return;
        const segs = 9;
        const pts  = [{ x: x1, y: y1 }];
        const seed = x1 * 100 + y1; // semi-stable per frame
        for (let i = 1; i < segs; i++) {
          const t  = i / segs;
          const px = x1 + (x2 - x1) * t;
          const py = y1 + (y2 - y1) * t;
          const jitter = (1 - Math.abs(t - 0.5) * 2) * 16;
          pts.push({
            x: px + (Math.sin(seed + i * 3.7) * jitter),
            y: py + (Math.cos(seed + i * 2.3) * jitter)
          });
        }
        pts.push({ x: x2, y: y2 });
        const end = Math.ceil(progress * segs);

        // Outer glow
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < end && i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = `rgba(120,200,255,${alpha * 0.28})`;
        ctx.lineWidth   = 7;
        ctx.lineCap     = 'round';
        ctx.shadowColor = 'rgba(80,180,255,0.7)';
        ctx.shadowBlur  = 12;
        ctx.stroke();

        // Core
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < end && i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = `rgba(210,240,255,${alpha})`;
        ctx.lineWidth   = 1.6;
        ctx.shadowBlur  = 0;
        ctx.stroke();
      }

      /* ── Glow dot ── */
      function drawNode(x, y, g) {
        if (g < 0.01) return;
        const r = 22 * g;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0,   `rgba(200,230,255,${g})`);
        grad.addColorStop(0.35,`rgba(80,160,255,${g * 0.55})`);
        grad.addColorStop(1,   `rgba(0,80,200,0)`);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        // White core
        ctx.beginPath();
        ctx.arc(x, y, 2.8 * g, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(220,240,255,${g})`;
        ctx.fill();
      }

      /* ── Main animation loop ── */
      let frameId, lastRAF = 0;

      function animate(now) {
        frameId = requestAnimationFrame(animate);
        const dt = Math.min(now - lastRAF, 50); lastRAF = now;
        const W  = canvas.width, H = canvas.height;

        // Auto slow rotate (stops when user is dragging)
        if (!isDragging) autoAngle += dt * 0.012;

        applyTransform();

        // Auto fire
        if (now - lastFire > FIRE_MS) {
          lastFire = now;
          const idx = fireQueue[fireIdx % fireQueue.length];
          fireIdx++;
          if (fireIdx >= fireQueue.length) {
            fireQueue = fireQueue.sort(() => Math.random() - 0.5);
            fireIdx   = 0;
          }
          fireNode(idx, false);
        }

        ctx.clearRect(0, 0, W, H);
        ctx.shadowBlur = 0;

        // Draw sparks
        for (let i = sparks.length - 1; i >= 0; i--) {
          const s = sparks[i];
          s.t += s.speed;
          if (s.t >= 1) {
            // Trigger destination node when bolt arrives
            if (!s.triggered) {
              s.triggered = true;
              nodeGlow[s.to] = Math.max(nodeGlow[s.to], 0.85);
              showLabel(s.to);
            }
            sparks.splice(i, 1);
            continue;
          }
          const fp = NODE_POSITIONS[s.from], tp = NODE_POSITIONS[s.to];
          const alpha = Math.sin(s.t * Math.PI) * 0.92;
          drawLightning(
            fp.x * W, fp.y * H,
            tp.x * W, tp.y * H,
            Math.min(s.t * 1.8, 1),
            alpha
          );
          // Light up destination as bolt approaches
          if (s.t > 0.7) nodeGlow[s.to] = Math.max(nodeGlow[s.to], (s.t - 0.7) * 2.5);
        }

        // Draw nodes
        NODE_POSITIONS.forEach((p, i) => {
          if (nodeGlow[i] > 0.01) {
            drawNode(p.x * W, p.y * H, nodeGlow[i]);
            nodeGlow[i] *= 0.90;
          }
          // Ambient dot always visible
          ctx.beginPath();
          ctx.arc(p.x * W, p.y * H, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(100,200,255,0.28)';
          ctx.fill();
        });
      }

      requestAnimationFrame(animate);

      return {
        destroy() {
          cancelAnimationFrame(frameId);
          ro.disconnect();
          window.removeEventListener('scroll', onScroll);
          wrapper.remove();
          overlay.remove();
        }
      };
    }
  };

})();
