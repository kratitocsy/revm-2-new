import { escHtml } from '../../lib/utils.js';
/* ── UNREAD MESSAGES + MISSED CALLS ───────────────────────────
   Puts a live count badge on the sidebar's "Study Partners" nav item
   (id="navPartnersBadge", added to every app page's sidebar) and pops
   a small toast when a friend messages you or a call goes unanswered,
   from ANY page — not just when partners.html/chat.html happens to be
   open. Call RevM2Notifications.init(sb, myUserId) once per page,
   right after a session exists. Idempotent; safe to never call. */
export const RevM2Notifications = (()=>{
  let channel = null, sbRef = null, myId = null;
  const senderCache = {}; // user_id -> {username, avatar_url}, best-effort memoization

  function badgeEl(){ return document.getElementById('navPartnersBadge'); }

  async function refreshCounts(){
    if(!sbRef || !myId) return;
    try{
      const { data } = await sbRef.from('dm_messages')
        .select('kind,call_status').eq('recipient_id', myId).is('read_at', null);
      const rows = data || [];
      const unreadMsgs = rows.filter(r=>r.kind==='text').length;
      const missedCalls = rows.filter(r=>r.kind==='call_log' && r.call_status==='missed').length;
      const total = unreadMsgs + missedCalls;
      const el = badgeEl();
      if(el){
        el.style.display = total>0 ? 'inline-flex' : 'none';
        el.textContent = total>9 ? '9+' : String(total);
        el.title = `${unreadMsgs} unread message${unreadMsgs===1?'':'s'} · ${missedCalls} missed call${missedCalls===1?'':'s'}`;
      }
    }catch(e){ /* badge is a nice-to-have, never break the page */ }
  }

  async function senderInfo(userId){
    if(senderCache[userId]) return senderCache[userId];
    try{
      const { data } = await sbRef.from('user_profiles').select('username,avatar_url').eq('id', userId).single();
      senderCache[userId] = data || {};
    }catch(e){ senderCache[userId] = {}; }
    return senderCache[userId];
  }

  function injectCSS(){
    if(document.getElementById('rm2-notify-toast-css')) return;
    const s=document.createElement('style');
    s.id='rm2-notify-toast-css';
    s.textContent=`
      #rm2-notify-toast{position:fixed;top:16px;right:16px;z-index:99997;
        background:rgba(10,10,14,0.97);border:1px solid rgba(200,169,110,0.4);
        border-radius:12px;padding:0.85rem 1rem;display:flex;align-items:center;gap:0.7rem;
        box-shadow:0 8px 32px rgba(0,0,0,0.5);font-family:inherit;max-width:290px;
        cursor:pointer;animation:rm2CallIn 0.25s ease;}
      #rm2-notify-toast .rm2nt-avatar{width:38px;height:38px;border-radius:50%;flex-shrink:0;
        background:#1a1a1f;overflow:hidden;display:flex;align-items:center;justify-content:center;
        border:2px solid rgba(200,169,110,0.5);color:#c8a96e;font-weight:700;font-size:0.85rem;}
      #rm2-notify-toast .rm2nt-avatar img{width:100%;height:100%;object-fit:cover;}
      #rm2-notify-toast .rm2nt-name{font-size:0.8rem;font-weight:700;color:#fff;}
      #rm2-notify-toast .rm2nt-sub{font-size:0.7rem;color:rgba(255,255,255,0.6);margin-top:0.15rem;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      #rm2-notify-toast .rm2nt-close{margin-left:auto;background:none;border:none;color:rgba(255,255,255,0.4);
        font-size:0.95rem;cursor:pointer;flex-shrink:0;}
    `;
    document.head.appendChild(s);
  }

  async function showToast(kind, row){
    injectCSS();
    const existing = document.getElementById('rm2-notify-toast');
    if(existing) existing.remove();
    const sender = await senderInfo(row.sender_id);
    const name = sender.username ? '@'+sender.username : 'Someone';
    const sub = kind==='message'
      ? escHtml((row.body||'').slice(0,60))
      : `Missed ${row.call_type==='video'?'video':'voice'} call`;
    const el = document.createElement('div');
    el.id = 'rm2-notify-toast';
    el.innerHTML = `
      <div class="rm2nt-avatar">${sender.avatar_url ? `<img src="${escHtml(sender.avatar_url)}">` : name.charAt(1)?.toUpperCase()||'?'}</div>
      <div style="min-width:0;"><div class="rm2nt-name">${escHtml(name)}</div><div class="rm2nt-sub">${sub}</div></div>
      <button class="rm2nt-close" title="Dismiss">✕</button>`;
    document.body.appendChild(el);
    el.querySelector('.rm2nt-close').onclick = (e) => { e.stopPropagation(); el.remove(); };
    el.onclick = () => { window.location.href = `chat.html?fid=${row.friendship_id}`; };
    setTimeout(()=>{ if(el.parentNode) el.remove(); }, 8000);
    if('Notification' in window && Notification.permission==='granted'){
      try{
        const n = new Notification(kind==='message' ? `${name} messaged you` : `Missed call from ${name}`, {
          body: kind==='message' ? (row.body||'').slice(0,80) : `You missed a ${row.call_type==='video'?'video':'voice'} call`,
          icon:'icon-192.png', tag:'revm2-'+kind
        });
        n.onclick = () => { window.focus(); window.location.href = `chat.html?fid=${row.friendship_id}`; };
      }catch(e){}
    }
  }

  function init(sb, myUserId){
    if(channel || !myUserId || !sb) return; // idempotent
    sbRef = sb; myId = myUserId;
    refreshCounts();
    channel = sb.channel(`user-notify-${myUserId}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'dm_messages', filter:`recipient_id=eq.${myUserId}` }, ({ new: row }) => {
        refreshCounts();
        // If chat.html is already open for this exact conversation, it already
        // shows the message/call-log inline and marks it read — no toast needed.
        const onThisChat = location.pathname.endsWith('chat.html') && new URLSearchParams(location.search).get('fid')===row.friendship_id;
        if(onThisChat) return;
        if(row.kind==='text') showToast('message', row);
        else if(row.kind==='call_log' && row.call_status==='missed') showToast('missed_call', row);
      })
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'dm_messages', filter:`recipient_id=eq.${myUserId}` }, () => refreshCounts())
      .subscribe();
    if('Notification' in window && Notification.permission==='default') Notification.requestPermission();
  }

  return { init, refreshCounts };
})();

