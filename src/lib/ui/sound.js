import { Store } from '../core/store.js';
/* ── ROCKET LAUNCH SOUND ──────────────────────────────────── */
/* Synthesized with Web Audio (no audio file to host/license) — a short
   ignition rumble + whoosh, timed to the rocket's animateMotion (~1.4s). */
export function isSoundOn(){ return Store.get('rm2_sound', true) !== false; }
export function setSoundOn(on){ Store.set('rm2_sound', on); }

export function playRocketLaunch(){
  if(!isSoundOn()) return;
  try{
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if(!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const dur = 1.3;

    // low rumble: pitch falls as the rocket climbs away
    const rumble = ctx.createOscillator();
    rumble.type = 'sawtooth';
    rumble.frequency.setValueAtTime(150, now);
    rumble.frequency.exponentialRampToValueAtTime(45, now + dur);
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.setValueAtTime(0, now);
    rumbleGain.gain.linearRampToValueAtTime(0.35, now + 0.05);
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    rumble.connect(rumbleGain);

    // noise burst: ignition + air whoosh
    const bufLen = ctx.sampleRate * dur;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for(let i=0;i<bufLen;i++) data[i] = Math.random()*2-1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(2200, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(300, now + dur);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0, now);
    noiseGain.gain.linearRampToValueAtTime(0.22, now + 0.04);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(noiseFilter); noiseFilter.connect(noiseGain);

    const master = ctx.createGain();
    master.gain.value = 0.9;
    rumbleGain.connect(master); noiseGain.connect(master);
    master.connect(ctx.destination);

    rumble.start(now); rumble.stop(now+dur);
    noise.start(now); noise.stop(now+dur);
    setTimeout(()=>{ try{ ctx.close(); }catch(e){} }, (dur+0.3)*1000);
  }catch(e){ /* sound is decorative — never break the page over it */ }
}

