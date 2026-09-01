/* ============================================================
   RevM² — src/lib/storage.js
   localStorage read/write/delete helpers, JSON-encoded, with
   try/catch so a full or disabled localStorage never throws.
   ============================================================ */
export const Store = {
  get: (k, fallback=null) => { try { const v=localStorage.getItem(k); return v?JSON.parse(v):fallback; } catch(e){ return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k,JSON.stringify(v)); } catch(e){} },
  del: (k) => { try { localStorage.removeItem(k); } catch(e){} }
};

