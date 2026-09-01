import { logEvent, escAttr, escHtml } from '../../lib/utils.js';
import { Store } from '../../lib/storage.js';
/* ── EXAM SWITCHER ────────────────────────────────────────── */
/* Click the sidebar track/exam labels to change your exam track.
   Auto-wires on any page that has #sTrack + #sExam in the DOM —
   no per-page markup needed; the modal is built and injected into
   the page the first time it's opened. */
export const EXAM_SWITCH_LIST = [
  ['JEE','JEE'],['NEET','NEET'],['IAT','IISER Aptitude'],['NEST','NEST'],
  ['BITSAT','BITSAT'],['CAT','CAT'],['UPSC CSE','UPSC CSE'],['SSC','SSC CGL/CHSL'],
  ['GATE','GATE'],['MHT-CET','MHT-CET'],['WBJEE','WBJEE'],['Other','Other']
];

export function initExamSwitcher(){
  const t = document.getElementById('sTrack'), e = document.getElementById('sExam');
  if(!t || !e) return;
  [t, e].forEach(el=>{
    el.style.cursor = 'pointer';
    el.title = 'Click to change your exam';
    el.addEventListener('click', openExamSwitcher);
  });
}
document.addEventListener('DOMContentLoaded', initExamSwitcher);

export function openExamSwitcher(){
  let modal = document.getElementById('examSwitchModal');
  if(!modal){
    document.body.insertAdjacentHTML('beforeend', `
      <style>
        #examSwitchModal .exam-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:0.6rem;margin-bottom:0.5rem;}
        #examSwitchModal .exam-card{border:1px solid var(--border2);background:var(--s2);padding:0.9rem 0.7rem;text-align:center;cursor:pointer;transition:all 0.15s;border-radius:8px;}
        #examSwitchModal .exam-card:hover{border-color:var(--gold-border);}
        #examSwitchModal .exam-card.selected{background:var(--gold-dim);border-color:var(--gold);}
        #examSwitchModal .exam-card-name{font-size:0.72rem;color:var(--text,#ccc);}
      </style>
      <div class="modal-overlay" id="examSwitchModal">
        <div class="modal">
          <h3>Change your exam</h3>
          <p>This updates your track everywhere, including Find a Partner eligibility.</p>
          <div class="exam-grid" id="examSwitchGrid"></div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="document.getElementById('examSwitchModal').classList.remove('show')">Cancel</button>
            <button class="btn btn-gold" id="examSwitchSaveBtn" onclick="saveExamSwitch()" disabled>Save</button>
          </div>
        </div>
      </div>`);
    modal = document.getElementById('examSwitchModal');
  }
  const grid = document.getElementById('examSwitchGrid');
  const current = (Store.get('revm2_config',{})||{}).exam || '';
  grid.innerHTML = EXAM_SWITCH_LIST.map(([v,l])=>
    `<div class="exam-card ${v===current?'selected':''}" data-v="${escAttr(v)}" onclick="pickExamSwitch(this)">
       <div class="exam-card-name">${escHtml(l)}</div>
     </div>`).join('');
  document.getElementById('examSwitchSaveBtn').disabled = !current;
  modal.classList.add('show');
}

export function pickExamSwitch(el){
  document.querySelectorAll('#examSwitchGrid .exam-card').forEach(c=>c.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('examSwitchSaveBtn').disabled = false;
}

export async function saveExamSwitch(){
  const picked = document.querySelector('#examSwitchGrid .exam-card.selected');
  if(!picked) return;
  const exam = picked.dataset.v;
  const track = exam + ' Track';
  const btn = document.getElementById('examSwitchSaveBtn');
  const origLabel = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving…';
  try{
    if(typeof sb === 'undefined') throw new Error('Not connected.');
    const {data:{session}} = await sb.auth.getSession();
    if(!session) throw new Error('Not signed in.');
    const {error} = await sb.from('user_profiles').update({ exam, track }).eq('id', session.user.id);
    if(error) throw error;

    const cfg = Store.get('revm2_config', {}) || {};
    cfg.exam = exam; cfg.track = track;
    Store.set('revm2_config', cfg);

    const tEl = document.getElementById('sTrack'), eEl = document.getElementById('sExam');
    if(tEl) tEl.textContent = track;
    if(eEl) eEl.textContent = exam;
    const topTrack = document.getElementById('topTrack');
    if(topTrack) topTrack.textContent = track;

    logEvent('exam_changed', 'settings', {exam});
    document.getElementById('examSwitchModal').classList.remove('show');
  }catch(err){
    alert(err.message || 'Could not save your exam right now — try again.');
  }finally{
    btn.disabled = false; btn.textContent = origLabel;
  }
}

