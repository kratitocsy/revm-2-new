import { INTERVALS } from '../../lib/core/config.js';
/* ── TRACKER SYNC (rows/slog ⇄ Supabase) ─────────────────── */
/* Debounced push of the local tracker snapshot to user_profiles. */
export let _syncTimer=null;
export function syncTrackerToSupabase(rows, slog){
  if(_syncTimer) clearTimeout(_syncTimer);
  _syncTimer=setTimeout(async()=>{
    try{
      if(typeof sb === 'undefined') return;
      const {data:{session}} = await sb.auth.getSession();
      if(!session) return;
      const totalSeconds = Object.values(slog||{}).reduce((sum,day)=>sum+Object.values(day).reduce((a,b)=>a+b,0),0);
      const totalDone = (rows||[]).reduce((sum,r)=>sum+INTERVALS.filter(iv=>r[iv.key]).length,0);
      await sb.from('user_profiles').update({
        tracker_data: rows, study_log: slog,
        total_study_seconds: totalSeconds, total_reviews_done: totalDone,
        last_active_at: new Date().toISOString()
      }).eq('id', session.user.id);
    }catch(e){ /* sync must never break the app */ }
  }, 1500);
}

/* Pull the latest snapshot from Supabase. Returns {rows,slog} or null if none saved yet. */
export async function pullTrackerFromSupabase(){
  try{
    if(typeof sb === 'undefined') return null;
    const {data:{session}} = await sb.auth.getSession();
    if(!session) return null;
    const {data} = await sb.from('user_profiles').select('tracker_data,study_log').eq('id',session.user.id).single();
    if(!data || !data.tracker_data) return null;
    return { rows: data.tracker_data, slog: data.study_log||{} };
  }catch(e){ return null; }
}

/* Pull onboarding config (subjects/exam/track/dates) from Supabase.
   Used when a device has no local revm2_config yet — a new browser, a new
   device, or storage that got cleared — so an account that already
   finished onboarding isn't sent through it again just because *this*
   browser is blank. Returns null only when the account genuinely hasn't
   onboarded yet (real new user). */
export async function pullConfigFromSupabase(){
  try{
    if(typeof sb === 'undefined') return null;
    const {data:{session}} = await sb.auth.getSession();
    if(!session) return null;
    const {data} = await sb.from('user_profiles')
      .select('subjects,exam,track,start_date,end_date,onboarded,explainer_seen')
      .eq('id',session.user.id).single();
    if(!data || !data.onboarded || !data.start_date) return null;
    return {
      subjects: data.subjects||[], exam: data.exam||null, track: data.track||null,
      start_date: data.start_date, end_date: data.end_date,
      onboarded: true, explainer_seen: data.explainer_seen!==false
    };
  }catch(e){ return null; }
}

