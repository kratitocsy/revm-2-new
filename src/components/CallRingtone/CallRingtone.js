import { isSoundOn } from '../SoundToggle/SoundToggle.js';
/* ── CALL RINGTONE — synthesized with Web Audio (same no-file approach as
   the rocket-launch sound above). Shared by chat.html's in-call ring UI
   AND the cross-page RevM2Calls toast below, so there's one ring sound
   site-wide. Loops until stopCallRingtone() is called. */
export let _ringAudioCtx = null, _ringLoopTimer = null;
export function startCallRingtone(){
  stopCallRingtone();
  if(!isSoundOn()) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if(!Ctx) return;
  _ringAudioCtx = new Ctx();
  const ringOnce = () => {
    if(!_ringAudioCtx) return;
    const now = _ringAudioCtx.currentTime;
    [0, 0.45].forEach(offset=>{
      const osc = _ringAudioCtx.createOscillator();
      const gain = _ringAudioCtx.createGain();
      osc.type = 'sine'; osc.frequency.value = 440;
      gain.gain.setValueAtTime(0, now+offset);
      gain.gain.linearRampToValueAtTime(0.18, now+offset+0.05);
      gain.gain.linearRampToValueAtTime(0, now+offset+0.38);
      osc.connect(gain); gain.connect(_ringAudioCtx.destination);
      osc.start(now+offset); osc.stop(now+offset+0.4);
    });
  };
  ringOnce();
  _ringLoopTimer = setInterval(ringOnce, 1600);
}
export function stopCallRingtone(){
  clearInterval(_ringLoopTimer); _ringLoopTimer = null;
  if(_ringAudioCtx){ try{ _ringAudioCtx.close(); }catch(e){} _ringAudioCtx = null; }
}

/* ── BROWSER NOTIFICATION for an incoming call — fires even if the tab
   isn't focused, so a call doesn't just silently ring out unseen. */
export let _ringNotification = null;
export function notifyIncomingCall(name){
  if(!('Notification' in window) || Notification.permission!=='granted') return;
  try{
    _ringNotification = new Notification('Incoming call', {
      body: `${name||'Someone'} is calling you on RevM²`,
      icon: 'icon-192.png', tag: 'revm2-incoming-call', requireInteraction: true
    });
    _ringNotification.onclick = () => { window.focus(); _ringNotification.close(); };
  }catch(e){ /* notifications are a nice-to-have, never break the call */ }
}
export function closeCallNotification(){ if(_ringNotification){ _ringNotification.close(); _ringNotification=null; } }

