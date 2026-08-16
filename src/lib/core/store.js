export const Store = {
  get: (k, fallback=null) => { try { const v=localStorage.getItem(k); return v?JSON.parse(v):fallback; } catch(e){ return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k,JSON.stringify(v)); } catch(e){} },
  del: (k) => { try { localStorage.removeItem(k); } catch(e){} }
};

