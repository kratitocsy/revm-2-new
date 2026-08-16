export const RM2_REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Animate a number from its current displayed value up/down to `target`.
   Safe to call repeatedly (e.g. on every refetch) — reads the currently
   shown number as the start point so it never "restarts from 0" on a
   simple re-render. Non-numeric current text is treated as starting at 0. */
export function rm2AnimateNumber(el, target, opts={}){
  if(!el) return;
  target = Number(target)||0;
  if(RM2_REDUCED_MOTION){ el.textContent = opts.format ? opts.format(target) : target.toLocaleString(); return; }
  const startVal = parseFloat((el.textContent||'').replace(/[^0-9.-]/g,'')) || 0;
  if(startVal === target){ el.textContent = opts.format ? opts.format(target) : target.toLocaleString(); return; }
  const duration = opts.duration || 600;
  const t0 = performance.now();
  const ease = t => 1 - Math.pow(1-t, 3); // ease-out cubic
  function tick(now){
    const p = Math.min(1, (now-t0)/duration);
    const val = Math.round(startVal + (target-startVal)*ease(p));
    el.textContent = opts.format ? opts.format(val) : val.toLocaleString();
    if(p < 1) requestAnimationFrame(tick);
    else{
      el.classList.remove('rm2-count-landed'); void el.offsetWidth; el.classList.add('rm2-count-landed');
    }
  }
  requestAnimationFrame(tick);
}

/* Add staggered fade-up entrance to a freshly-rendered list of elements.
   Call right after setting .innerHTML on a container:
     container.innerHTML = items.map(renderItem).join('');
     rm2Stagger(container.children);
   Each child gets .rm2-in with an incremental delay (capped so long
   lists don't take forever to finish appearing). */
export function rm2Stagger(nodeList, opts={}){
  if(RM2_REDUCED_MOTION) return;
  const step = opts.step ?? 35;   // ms between each item
  const cap = opts.cap ?? 10;     // stop increasing delay after N items
  Array.from(nodeList).forEach((el,i)=>{
    el.style.setProperty('--d', `${Math.min(i,cap)*step}ms`);
    el.classList.add('rm2-in');
  });
}

/* ============================================================
   MOBILE-NATIVE SHELL (Tier 1 — Capacitor Android wrapper)
   Runs ONLY inside the Capacitor native app (window.Capacitor.
   isNativePlatform() === true). On regular web/desktop this whole
   block is a no-op — zero effect on the existing site.

   Swaps the desktop `.sidebar` for a bottom tab bar, wires up
   native chrome (status bar / splash / haptics / keyboard), and
   exposes RM2Native.* helpers other pages/plugins can call.
   Load order: after this file, before page-specific inline scripts.
   ============================================================ */
(function initMobileNativeShell(){
  function isNative(){
    return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform());
  }

  const RM2Native = {
    isNative,
    plugin(name){
      return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name];
    },
    haptic(style){ // 'light' | 'medium' | 'heavy'
      const H = this.plugin('Haptics');
      if(!H) return;
      const map = { light:'LIGHT', medium:'MEDIUM', heavy:'HEAVY' };
      H.impact({ style: map[style] || 'LIGHT' }).catch(()=>{});
    }
  };
  window.RM2Native = RM2Native;

  if(!isNative()) return; // web/desktop: stop here, nothing else runs

  document.documentElement.classList.add('rm2-native-shell');

  /* ── Native chrome: status bar, splash, keyboard ─────────── */
  function setupChrome(){
    const StatusBar = RM2Native.plugin('StatusBar');
    if(StatusBar){
      StatusBar.setBackgroundColor({ color: '#0b0b0f' }).catch(()=>{});
      StatusBar.setStyle({ style: 'DARK' }).catch(()=>{});
    }
    const Keyboard = RM2Native.plugin('Keyboard');
    if(Keyboard && Keyboard.addListener){
      // Push content above the keyboard instead of letting it cover
      // chat/composer inputs — pairs with .rm2-kb-pad in style.css.
      Keyboard.addListener('keyboardWillShow', info => {
        document.documentElement.style.setProperty('--rm2-kb-height', (info.keyboardHeight||0)+'px');
        document.documentElement.classList.add('rm2-kb-open');
      });
      Keyboard.addListener('keyboardWillHide', () => {
        document.documentElement.classList.remove('rm2-kb-open');
        document.documentElement.style.setProperty('--rm2-kb-height', '0px');
      });
    }
    // Hide splash once the page has painted its first frame.
    const Splash = RM2Native.plugin('SplashScreen');
    if(Splash){
      requestAnimationFrame(() => requestAnimationFrame(() => {
        Splash.hide().catch(()=>{});
      }));
    }
  }

  /* ── Bottom tab bar: Tracker / Groups / Timer / Leaderboard / Profile ── */
  const TABS = [
    { key:'tracker',    label:'Tracker',    href:'tracker.html',   icon:'M6 4h12v17H6zM9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M9 11h6M9 15h6' },
    { key:'groups',     label:'Groups',     href:'groups.html',    icon:'M16 21v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V21M9 7.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM17.5 11a3.5 3.5 0 1 0 0-7' },
    { key:'timer',      label:'Timer',      href:'timer.html',     icon:'M7 3h10M7 21h10M8 3c0 4 3 5 4 6.5C13 8 16 7 16 3M8 21c0-4 3-5 4-6.5C13 16 16 17 16 21' },
    { key:'leaderboard',label:'Leaderboard',href:'partners.html',  icon:'M4 20V13M12 20V8M20 20v-4M4 11l8-5 8 3' },
    { key:'profile',    label:'Profile',    href:'onboarding.html',icon:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6' }
  ];

  function currentTabKey(){
    const file = (location.pathname.split('/').pop() || 'index.html');
    if(file.startsWith('tracker')) return 'tracker';
    if(file.startsWith('groups')) return 'groups';
    if(file.startsWith('timer')) return 'timer';
    if(file.startsWith('partners')) return 'leaderboard';
    if(file.startsWith('onboarding') || file.startsWith('login')) return 'profile';
    return null;
  }

  function buildTabBar(){
    if(document.getElementById('rm2NativeTabBar')) return; // idempotent
    if(!document.querySelector('.sidebar')) return; // non-app page (login, admin, etc.) — no bottom nav

    // Desktop sidebar stays in the DOM (other code queries it) but is
    // visually hidden on native — see .rm2-native-shell .sidebar in CSS.
    const active = currentTabKey();
    const bar = document.createElement('nav');
    bar.id = 'rm2NativeTabBar';
    bar.className = 'rm2-native-tabbar';
    bar.innerHTML = TABS.map(t => `
      <a href="${t.href}" class="rm2-tab${t.key===active ? ' active' : ''}" data-tab="${t.key}">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${t.icon}"/></svg>
        <span>${t.label}</span>
      </a>`).join('');
    bar.addEventListener('click', e => {
      const a = e.target.closest('.rm2-tab');
      if(a) RM2Native.haptic('light');
    });
    document.body.appendChild(bar);
    document.body.classList.add('rm2-has-tabbar');
  }

  function boot(){
    setupChrome();
    buildTabBar();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
