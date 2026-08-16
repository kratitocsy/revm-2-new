/* ── ANALYTICS / EVENT LOGGING ───────────────────────────── */
/* Fire-and-forget. Call after `const sb = supabase.createClient(...)` exists on the page.
   Usage: logEvent('feature_used', 'timer'); logEvent('review_completed'); */
export async function logEvent(eventType, feature=null, meta=null){
  try{
    if(typeof sb === 'undefined') return;
    const {data:{session}} = await sb.auth.getSession();
    if(!session) return;
    await sb.from('user_events').insert({
      user_id: session.user.id, event_type: eventType, feature, meta
    });
  }catch(e){ /* analytics must never break the app */ }
}

