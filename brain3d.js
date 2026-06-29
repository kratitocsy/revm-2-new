/* ============================================================
   RevM² — brain3d.js  v2
   Neurologically accurate colours. Scroll-driven. Ambient-matched.
   ============================================================

   NEUROSCIENCE COLOUR BASIS
   ─────────────────────────
   Human visual cortex responds most strongly to:
   • Deep RED / magenta  — highest cone sensitivity, maximum salience (danger signal)
   • Electric BLUE-CYAN  — dopamine / reward circuitry activation (memory formation)
   • Warm AMBER / orange — attention & alertness (reticular activating system)
   • Lime GREEN          — highest luminous efficiency of human eye (photopic peak 555nm)
   • Violet / purple     — hippocampal encoding signal in neuroscience imaging studies

   Background match: brain lobes tinted #0d1520 → #1a2a3a (blue-black)
   so neurons POP against it. The dark cool base mimics MRI scan aesthetics
   people already associate with "brain" — makes it feel authentic.
   ============================================================ */

(function () {
  'use strict';

  /* ── Neurologically salient palette ────────────────────── */
  const NEURO = {
    // Firing colours — chosen for max visual salience on dark bg
    RED:    { hex: 0xff3366, css: '#ff3366' },  // threat / urgency — max salience
    AMBER:  { hex: 0xff8c00, css: '#ff8c00' },  // alertness / dopamine
    CYAN:   { hex: 0x00d4ff, css: '#00d4ff' },  // memory / reward
    GREEN:  { hex: 0x39ff14, css: '#39ff14' },  // photopic peak — neon lime
    VIOLET: { hex: 0xbf5fff, css: '#bf5fff' },  // hippocampal encoding
    GOLD:   { hex: 0xffd700, css: '#ffd700' },  // attention / warm signal
  };

  // Each subject gets its most neurologically appropriate colour
  const SUBJECT_COLORS = {
    Physics:   NEURO.CYAN,    // reward / cognitive load = cyan
    Chemistry: NEURO.GREEN,   // photopic peak — most visible
    Maths:     NEURO.AMBER,   // alertness, concentration
    Biology:   NEURO.VIOLET,  // hippocampal / memory science
    Default:   NEURO.RED,
  };

  // Firing flash colours rotate through all 6 for visual richness
  const FIRE_PALETTE = Object.values(NEURO);

  /* ── JEE / NEET chapter pool ────────────────────────────── */
  const CHAPTER_POOL = {
    Physics: [
      'Kinematics','Laws of Motion','Work & Energy','Rotational Motion',
      'Gravitation','SHM','Waves','Thermodynamics','Electrostatics',
      'Current Electricity','Magnetism','EMI','Optics','Modern Physics',
      'Semiconductors','Fluid Mechanics','Ray Optics'
    ],
    Chemistry: [
      'Mole Concept','Atomic Structure','Chemical Bonding','Thermodynamics',
      'Equilibrium','Redox','Electrochemistry','Organic Reactions',
      'Hydrocarbons','Aldehydes & Ketones','Amines','Polymers',
      'p-Block Elements','d-Block Elements','Solutions','Coordination Compounds'
    ],
    Maths: [
      'Limits & Continuity','Differentiation','Integration','Differential Eq',
      'Matrices & Det','Probability','Permutation','Complex Numbers',
      'Vectors','3D Geometry','Conic Sections','Sequences & Series',
      'Trigonometry','Sets & Relations','Statistics','Binomial Theorem'
    ],
    Biology: [
      'Cell Biology','Genetics','Evolution','Human Physiology',
      'Plant Physiology','Ecology','Reproduction','Biotechnology',
      'Biomolecules','Animal Kingdom','Plant Kingdom','Microbes'
    ]
  };

  function randomChapters(n = 24) {
    const subjects = Object.keys(CHAPTER_POOL);
    const out = [];
    while (out.length < n) {
      const sub = subjects[Math.floor(Math.random() * subjects.length)];
      const pool = CHAPTER_POOL[sub];
      const ch = pool[Math.floor(Math.random() * pool.length)];
      if (!out.find(x => x.name === ch)) out.push({ name: ch, subject: sub });
    }
    return out;
  }

  function chaptersFromRows(rows) {
    const seen = new Set(), out = [];
    for (const r of rows) {
      if (r.topic && !seen.has(r.topic)) {
        seen.add(r.topic);
        const subRaw = (r.subject || 'Maths').trim();
        const sub = Object.keys(CHAPTER_POOL).find(
          s => subRaw.toLowerCase().startsWith(s.toLowerCase())
        ) || 'Maths';
        const done = ['r0','r1','r2','r3','r4','r5','r6','r7'].filter(k => r[k]).length;
        out.push({ name: r.topic, subject: sub, strength: done / 8 });
      }
      if (out.length >= 30) break;
    }
    return out.length ? out : randomChapters(24);
  }

  /* ── BrainViz API ────────────────────────────────────────── */
  window.BrainViz = {
    mount(target, opts = {}) {
      const container = typeof target === 'string'
        ? document.querySelector(target) : target;
      if (!container || typeof THREE === 'undefined') return null;

      const mode = opts.mode || 'home';
      const chapters = (mode === 'dashboard' && opts.rows && opts.rows.length)
        ? chaptersFromRows(opts.rows) : randomChapters(24);

      /* ── Renderer ──────────────────────────────────────── */
      const W = container.clientWidth  || 800;
      const H = container.clientHeight || 600;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(W, H);
      renderer.setClearColor(0x000000, 0);
      renderer.shadowMap.enabled = false;
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      // Subtle fog — fades the back of the brain into the dark bg
      scene.fog = new THREE.FogExp2(0x07090d, 0.18);

      const camera = new THREE.PerspectiveCamera(48, W / H, 0.1, 60);
      camera.position.set(0, 0.05, 3.2);

      /* ── Lighting — tuned for wet, MRI-like brain surface ── */
      // Cool ambient (blue-black room)
      scene.add(new THREE.AmbientLight(0x0a0f1a, 3.0));

      // Key light — warm top-right (mimics your screenshot)
      const key = new THREE.DirectionalLight(0xffd4a0, 3.8);
      key.position.set(2.5, 3.5, 4);
      scene.add(key);

      // Rim light — cold cyan from back-left (neurological blue)
      const rim = new THREE.DirectionalLight(0x00aaff, 1.2);
      rim.position.set(-3.5, 0, -2);
      scene.add(rim);

      // Under fill — deep purple (depth perception)
      const fill = new THREE.DirectionalLight(0x3a0066, 0.8);
      fill.position.set(0, -3, 1);
      scene.add(fill);

      /* ── Brain mesh ───────────────────────────────────── */
      const brainGroup = new THREE.Group();
      scene.add(brainGroup);

      /* Organic distortion — higher freq than before for sulci-like folds */
      function makeLobe(rx, ry, rz, ox, oy, oz, baseColor) {
        const geo = new THREE.SphereGeometry(1, 96, 72);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
          // Multi-frequency noise for realistic cortical folding
          const d1 = 0.072 * Math.sin(x * 8.7 + y * 5.3 + z * 3.1);
          const d2 = 0.038 * Math.sin(x * 14.2 + z * 9.8);
          const d3 = 0.022 * Math.cos(y * 19.1 + x * 7.3);
          pos.setXYZ(i, x + d1 + d3, y + d1 + d2, z + d2 + d3);
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();

        const mat = new THREE.MeshStandardMaterial({
          color: baseColor,
          roughness: 0.72,
          metalness: 0.04,
          // Subtle emissive so the brain glows very faintly from within
          emissive: new THREE.Color(baseColor).multiplyScalar(0.06),
        });
        const m = new THREE.Mesh(geo, mat);
        m.scale.set(rx, ry, rz);
        m.position.set(ox, oy, oz);
        return m;
      }

      // Hemispheres — deep blue-grey to match your dark bg
      const LOBE_L = 0x0e1b2e;
      const LOBE_R = 0x111f30;
      const CEREBELLUM = 0x0a1520;

      brainGroup.add(makeLobe(1.06, 0.95, 0.92,  0.50, 0.06, 0,     LOBE_L));
      brainGroup.add(makeLobe(1.02, 0.93, 0.90, -0.46, 0.06, 0,     LOBE_R));
      brainGroup.add(makeLobe(0.60, 0.44, 0.52,  0.0, -0.70, -0.58, CEREBELLUM));

      // Brainstem
      const stemG = new THREE.CylinderGeometry(0.13, 0.17, 0.48, 12);
      const stemM = new THREE.MeshStandardMaterial({ color: 0x090f1a, roughness: 0.95 });
      const stem  = new THREE.Mesh(stemG, stemM);
      stem.position.set(0, -1.08, -0.32);
      brainGroup.add(stem);

      /* Cortex sheen — very fine wireframe picks out sulci */
      const cortexG = new THREE.SphereGeometry(1.055, 32, 22);
      const cortexM = new THREE.MeshBasicMaterial({
        color: 0x3399ff, wireframe: true,
        transparent: true, opacity: 0.028
      });
      const cortex = new THREE.Mesh(cortexG, cortexM);
      cortex.scale.set(1.02, 0.95, 0.91);
      brainGroup.add(cortex);

      /* Outer glow shell — large transparent sphere, additive blend */
      const glowG = new THREE.SphereGeometry(1.18, 32, 24);
      const glowM = new THREE.MeshBasicMaterial({
        color: 0x0044aa,
        transparent: true, opacity: 0.055,
        side: THREE.BackSide
      });
      brainGroup.add(new THREE.Mesh(glowG, glowM));

      /* ── Neurons ─────────────────────────────────────── */
      const neurons = [];
      const neuronGroup = new THREE.Group();
      brainGroup.add(neuronGroup);

      const nGeo = new THREE.SphereGeometry(0.022, 10, 10);

      chapters.forEach((ch, i) => {
        const sc = SUBJECT_COLORS[ch.subject] || SUBJECT_COLORS.Default;
        const mat = new THREE.MeshBasicMaterial({
          color: sc.hex, transparent: true, opacity: 0.85
        });
        const mesh = new THREE.Mesh(nGeo, mat);

        // Fibonacci sphere distribution — even coverage
        const phi   = Math.acos(1 - 2 * (i + 0.5) / chapters.length);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;
        const r = 0.78 + Math.random() * 0.26;
        mesh.position.set(
          r * Math.sin(phi) * Math.cos(theta),
          r * Math.sin(phi) * Math.sin(theta) * 0.88,
          r * Math.cos(phi) * 0.80
        );

        neuronGroup.add(mesh);
        neurons.push({
          mesh, chapter: ch,
          baseColor: sc.hex,
          firing: false, fireT: 0,
          fireColorIdx: i % FIRE_PALETTE.length,
          _lines: []
        });
      });

      /* ── Synaptic connections ────────────────────────── */
      const lineGroup = new THREE.Group();
      brainGroup.add(lineGroup);

      neurons.forEach((n, i) => {
        // Connect to 3 nearest
        const nearest = neurons
          .map((m, j) => ({ j, d: n.mesh.position.distanceTo(m.mesh.position) }))
          .filter(x => x.j !== i).sort((a,b) => a.d - b.d).slice(0, 3);

        nearest.forEach(({ j }) => {
          const pts = [n.mesh.position.clone(), neurons[j].mesh.position.clone()];
          const g = new THREE.BufferGeometry().setFromPoints(pts);
          const m = new THREE.LineBasicMaterial({
            color: n.baseColor, transparent: true, opacity: 0
          });
          lineGroup.add(new THREE.Line(g, m));
          n._lines.push(m);
        });
      });

      /* ── Floating HTML labels ────────────────────────── */
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:6;';
      container.style.position = 'relative';
      container.appendChild(overlay);

      const labelEls = neurons.map(n => {
        const sc  = SUBJECT_COLORS[n.chapter.subject] || SUBJECT_COLORS.Default;
        const el  = document.createElement('div');
        // Connector line SVG
        el.innerHTML = `
          <div style="
            background:rgba(4,6,12,0.92);
            border:1px solid ${sc.css}55;
            border-left:2px solid ${sc.css};
            padding:0.28rem 0.6rem 0.3rem;
            border-radius:0 3px 3px 0;
            line-height:1.3;
            box-shadow:0 0 18px ${sc.css}22, inset 0 0 8px rgba(0,0,0,0.5);
          ">
            <div style="color:${sc.css};font-size:0.54rem;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:0.1rem;">${n.chapter.subject}</div>
            <div style="color:#ffffff;font-size:0.76rem;font-weight:700;letter-spacing:-0.01em;">${n.chapter.name}</div>
          </div>
        `;
        el.style.cssText = `
          position:absolute;
          opacity:0;
          transform:translate(-50%,-50%) scale(0.8) translateY(6px);
          transition:opacity 0.35s ease, transform 0.35s cubic-bezier(0.34,1.56,0.64,1);
          white-space:nowrap;
          pointer-events:none;
          will-change:transform,opacity;
          filter:drop-shadow(0 0 10px ${sc.css}44);
        `;
        overlay.appendChild(el);
        return el;
      });

      /* ── Firing sequence ─────────────────────────────── */
      let firingQueue = [], firingIdx = 0;
      function shuffle() {
        firingQueue = [...Array(neurons.length).keys()];
        for (let i = firingQueue.length-1; i > 0; i--) {
          const j = Math.floor(Math.random()*(i+1));
          [firingQueue[i],firingQueue[j]] = [firingQueue[j],firingQueue[i]];
        }
      }
      shuffle();

      // 2 neurons fire simultaneously for richness, every 550ms
      let lastFire = 0;
      const FIRE_MS = 550;

      function fireNeuron(idx) {
        const n = neurons[idx];
        n.firing = true;
        n.fireT  = 0;
        // Pick a vivid fire colour (cycles through neuro palette)
        const fc = FIRE_PALETTE[(idx + Math.floor(Date.now()/3000)) % FIRE_PALETTE.length];
        n.mesh.material.color.setHex(fc.hex);

        // Flash synapse lines
        n._lines.forEach(m => {
          m.color.setHex(fc.hex);
          m.opacity = 0.7;
          setTimeout(() => { m.opacity = 0; }, 480);
        });

        // Show label
        const el = labelEls[idx];
        el.style.opacity  = '1';
        el.style.transform = 'translate(-50%,-50%) scale(1) translateY(0)';
        setTimeout(() => {
          el.style.opacity   = '0';
          el.style.transform = 'translate(-50%,-50%) scale(0.85) translateY(4px)';
          // Reset neuron colour after label fades
          setTimeout(() => {
            n.mesh.material.color.setHex(n.baseColor);
          }, 350);
        }, 2000);
      }

      /* ── Scroll ──────────────────────────────────────── */
      let scrollProg = 0;
      function onScroll() {
        const sy = window.scrollY;
        const vh = window.innerHeight;
        scrollProg = Math.min(1, sy / vh);
      }
      window.addEventListener('scroll', onScroll, { passive: true });

      /* ── Label projection ────────────────────────────── */
      const _v = new THREE.Vector3();
      function project(worldPos) {
        _v.copy(worldPos);
        brainGroup.updateMatrixWorld();
        _v.applyMatrix4(brainGroup.matrixWorld);
        _v.project(camera);
        return {
          x: ((_v.x + 1) / 2) * renderer.domElement.clientWidth,
          y: ((-_v.y + 1) / 2) * renderer.domElement.clientHeight,
          z: _v.z
        };
      }

      /* ── Animation loop ──────────────────────────────── */
      let t = 0, destroyed = false;

      function animate(now) {
        if (destroyed) return;
        requestAnimationFrame(animate);
        t += 0.007;

        // Scroll: Y rotation 0→3.2rad + tilt + zoom
        brainGroup.rotation.y = t * 0.10 + scrollProg * 3.2;
        brainGroup.rotation.x = -0.10 + scrollProg * 0.40;
        camera.position.z     = 3.2  - scrollProg * 1.4;

        // Gentle float
        brainGroup.position.y = Math.sin(t * 0.45) * 0.035;

        // Cortex shimmer
        cortex.material.opacity = 0.022 + Math.sin(t * 1.4) * 0.008;

        // Fire 2 neurons per tick
        if (now - lastFire > FIRE_MS) {
          lastFire = now;
          for (let k = 0; k < 2; k++) {
            const idx = firingQueue[firingIdx % firingQueue.length];
            firingIdx++;
            if (firingIdx >= firingQueue.length) { shuffle(); firingIdx = 0; }
            fireNeuron(idx);
          }
        }

        // Animate neurons + update labels
        neurons.forEach((n, i) => {
          if (n.firing) {
            n.fireT += 0.10;
            const s = 1 + Math.sin(n.fireT * Math.PI) * 3.5;
            n.mesh.scale.setScalar(Math.max(0.1, s));
            n.mesh.material.opacity = Math.max(0.15, Math.sin(n.fireT * Math.PI * 0.8));
            if (n.fireT >= Math.PI) {
              n.firing = false;
              n.mesh.scale.setScalar(1);
              n.mesh.material.opacity = 0.85;
            }
          }

          // Update label position
          const sc = project(n.mesh.position);
          if (sc.z < 1) {
            labelEls[i].style.left = sc.x + 'px';
            labelEls[i].style.top  = sc.y + 'px';
          }
        });

        renderer.render(scene, camera);
      }
      requestAnimationFrame(animate);

      /* ── Resize ──────────────────────────────────────── */
      const ro = new ResizeObserver(() => {
        const w = container.clientWidth, h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      });
      ro.observe(container);

      return {
        destroy() {
          destroyed = true;
          ro.disconnect();
          window.removeEventListener('scroll', onScroll);
          renderer.dispose();
          renderer.domElement.remove();
          overlay.remove();
        },
        updateRows(rows) {
          this.destroy();
          BrainViz.mount(container, { ...opts, mode: 'dashboard', rows });
        }
      };
    }
  };

})();
