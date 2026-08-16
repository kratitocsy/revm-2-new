import { escHtml } from '../core/format.js';
import { closeCallNotification, notifyIncomingCall, startCallRingtone, stopCallRingtone } from './call-ringtone.js';
/* ── GLOBAL CROSS-PAGE INCOMING-CALL TOAST ───────────────────
   chat.html's call system only ever rang on the exact chat.html?fid=
   page for that friendship — if you were on tracker/groups/store/etc.
   when someone called, you never knew. This listens for a call ping
   on a per-user channel (sent by chat.html's startCall alongside its
   normal per-friendship ring) and shows a small Accept/Decline toast
   with ringtone + Notification, from ANY page. Call RevM2Calls.init(sb,
   myUserId) once per page, right after a session exists. Idempotent —
   safe to call more than once; safe to never call at all. */
export const RevM2Calls = (()=>{
  let channel = null, activeToast = null;

  function injectCSS(){
    if(document.getElementById('rm2-call-toast-css')) return;
    const s=document.createElement('style');
    s.id='rm2-call-toast-css';
    s.textContent=`
      #rm2-call-toast{position:fixed;top:16px;right:16px;z-index:99998;
        background:rgba(10,10,14,0.97);border:1px solid rgba(200,169,110,0.4);
        border-radius:12px;padding:0.9rem 1rem;display:flex;align-items:center;gap:0.75rem;
        box-shadow:0 8px 32px rgba(0,0,0,0.5);font-family:inherit;max-width:300px;
        animation:rm2CallIn 0.25s ease;}
      @keyframes rm2CallIn{from{opacity:0;transform:translateY(-10px);}to{opacity:1;transform:translateY(0);}}
      #rm2-call-toast .rm2ct-avatar{width:42px;height:42px;border-radius:50%;flex-shrink:0;
        background:#1a1a1f;overflow:hidden;display:flex;align-items:center;justify-content:center;
        border:2px solid rgba(200,169,110,0.5);color:#c8a96e;font-weight:700;font-size:0.9rem;}
      #rm2-call-toast .rm2ct-avatar img{width:100%;height:100%;object-fit:cover;}
      #rm2-call-toast .rm2ct-name{font-size:0.82rem;font-weight:700;color:#fff;}
      #rm2-call-toast .rm2ct-sub{font-size:0.68rem;color:rgba(255,255,255,0.55);margin-top:0.1rem;}
      #rm2-call-toast .rm2ct-btns{display:flex;gap:0.4rem;margin-left:auto;}
      #rm2-call-toast button{width:34px;height:34px;border-radius:50%;border:none;cursor:pointer;
        display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;}
      #rm2-call-toast .rm2ct-accept{background:radial-gradient(circle at 35% 30%,#5be89a,#1fae63);}
      #rm2-call-toast .rm2ct-decline{background:radial-gradient(circle at 35% 30%,#fb7373,#e03e3e);}
    `;
    document.head.appendChild(s);
  }

  function dismiss(){
    if(activeToast){ activeToast.remove(); activeToast=null; }
    stopCallRingtone();
    closeCallNotification();
  }

  function showToast(sb, payload){
    dismiss();
    injectCSS();
    const name = payload.fromUsername ? '@'+payload.fromUsername : 'Someone';
    const el = document.createElement('div');
    el.id = 'rm2-call-toast';
    el.innerHTML = `
      <div class="rm2ct-avatar">${payload.fromAvatarUrl ? `<img src="${escHtml(payload.fromAvatarUrl)}">` : (payload.fromUsername||'?').charAt(0).toUpperCase()}</div>
      <div><div class="rm2ct-name">${escHtml(name)}</div><div class="rm2ct-sub">Incoming ${payload.callType==='video'?'video':'voice'} call…</div></div>
      <div class="rm2ct-btns">
        <button class="rm2ct-decline" title="Decline">✕</button>
        <button class="rm2ct-accept" title="Accept">${payload.callType==='video'?'▶':'📞'}</button>
      </div>`;
    document.body.appendChild(el);
    activeToast = el;
    startCallRingtone();
    notifyIncomingCall(name);
    el.querySelector('.rm2ct-decline').onclick = () => {
      dismiss();
      try{
        const declineCh = sb.channel(`dm-call-${payload.fid}`);
        declineCh.subscribe(status=>{
          if(status==='SUBSCRIBED'){
            declineCh.send({ type:'broadcast', event:'call', payload:{ from:payload.toUserId, to:payload.fromUserId, kind:'decline' } });
            setTimeout(()=>sb.removeChannel(declineCh), 800);
          }
        });
      }catch(e){}
    };
    el.querySelector('.rm2ct-accept').onclick = () => {
      dismiss();
      window.location.href = `chat.html?fid=${payload.fid}&call=${payload.callType}&autoaccept=1`;
    };
  }

  function init(sb, myUserId){
    if(channel || !myUserId || !sb) return; // idempotent
    channel = sb.channel(`user-calls-${myUserId}`)
      .on('broadcast', { event:'incoming_call' }, ({payload}) => {
        // If chat.html is already open for this exact friendship, its own
        // per-friendship ring already handles it — don't double-toast.
        if(location.pathname.endsWith('chat.html') && new URLSearchParams(location.search).get('fid')===payload.fid) return;
        showToast(sb, payload);
      })
      .subscribe();
    if('Notification' in window && Notification.permission==='default') Notification.requestPermission();
  }

  return { init };
})();

