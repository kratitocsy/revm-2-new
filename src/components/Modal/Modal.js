/* ============================================================
   RevM² — src/components/Modal/Modal.js

   Every modal in the app follows the same shape:
     <div class="modal-overlay" id="...">
       <div class="modal"> ... </div>
     </div>
   toggled via `.classList.add/remove('show')` on the overlay.
   That pattern was previously hand-rolled separately in
   src/components/Sidebar/exam-switcher.js (dynamically injected) and inline
   in home.html (logModeModal, static markup) — same shape, two
   copies. This is the shared version.

   Usage:
     import { openModal, closeModal, injectModal } from '../components/Modal/Modal.js';

     injectModal('myModal', '<h3>Title</h3><p>Body</p>');
     openModal('myModal');
     closeModal('myModal');

   Existing pages are NOT auto-migrated to this yet — exam-switcher.js
   still has its own inline injection. See docs/MODULARIZATION.md for
   the migration status.
   ============================================================ */

/** Insert a modal's markup into the DOM if it isn't already there. Returns the overlay element. */
export function injectModal(id, innerHtml){
  let overlay = document.getElementById(id);
  if (!overlay){
    document.body.insertAdjacentHTML('beforeend',
      `<div class="modal-overlay" id="${id}"><div class="modal">${innerHtml}</div></div>`);
    overlay = document.getElementById(id);
  }
  return overlay;
}

export function openModal(id){
  const overlay = document.getElementById(id);
  if (overlay) overlay.classList.add('show');
}

export function closeModal(id){
  const overlay = document.getElementById(id);
  if (overlay) overlay.classList.remove('show');
}

/** Close-on-backdrop-click: call once per modal id after injecting it. */
export function wireBackdropClose(id){
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(id);
  });
}
