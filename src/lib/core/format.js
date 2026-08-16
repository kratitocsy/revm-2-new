/* ── DATE HELPERS ────────────────────────────────────────── */
export const TODAY = (() => { const d=new Date(); d.setHours(0,0,0,0); return d; })();
export const TODAY_STR = TODAY.toISOString().split('T')[0];

export function fmtDateShort(d) {
  return new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'});
}
export function fmtDateFull(d) {
  return new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
}
export function fmtTime(secs) {
  const h=Math.floor(secs/3600), m=Math.floor((secs%3600)/60);
  return h>0?`${h}h ${m}m`:`${m}m`;
}
export function escHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* escAttr: use this instead of escHtml whenever a value is being embedded
   inside a single-quoted JS string literal in an inline handler, e.g.
   onclick="doThing('${escAttr(name)}')". escHtml alone is NOT safe there --
   the browser HTML-decodes attribute values BEFORE handing them to the JS
   parser, so an HTML-encoded quote (&#39;) just turns back into a real '
   and still breaks out of the string. escAttr backslash-escapes the
   characters that matter to the JS parser first (so the quote survives
   HTML decoding as an inert escaped char), then HTML-escapes the result
   for the surrounding double-quoted attribute. */
export function escAttr(s){
  s = String(s==null ? '' : s)
    .replace(/\\/g,'\\\\')
    .replace(/'/g,"\\'")
    .replace(/\n/g,'\\n')
    .replace(/\r/g,'\\r');
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

