/* ============================================================
   RevM² — src/components/Button.js

   Buttons here are plain CSS classes (styled in style.css /
   src/styles/base.css) — there's no JS component to render one.
   What WAS duplicated is the "loading spinner" behavior: several
   pages (login.html being the biggest) manually grab
   `.btn-spinner` inside a button and toggle its display + swap
   label text + disable the button, by hand, every time.

   This gives that pattern one implementation.

   Class reference (for anyone building new markup):
     btn                base button
     btn-primary         filled, primary action
     btn-primary-full     primary, full width
     btn-gold             gold/accent filled
     btn-ghost             outline/transparent
     btn-grad              gradient fill
     btn-tiny gold         compact gold variant
     btn btn-*-sm          small size modifier, combine with any variant above

   Usage:
     <button class="btn btn-gold" id="saveBtn">
       <span class="btn-label">Save</span>
       <div class="btn-spinner" style="display:none;"></div>
     </button>

     import { setButtonLoading } from '../components/Button.js';
     setButtonLoading(document.getElementById('saveBtn'), true, 'Saving…');
     // ...
     setButtonLoading(document.getElementById('saveBtn'), false);
   ============================================================ */

const ORIG_LABEL = new WeakMap();

/**
 * Toggle a button's loading state: disables it, swaps its label
 * text (if it has a `.btn-label` or `.oauth-label` child, else the
 * button's own text), and shows/hides a `.btn-spinner` child if present.
 */
export function setButtonLoading(btn, loading, loadingLabel = '…'){
  if (!btn) return;
  const labelEl = btn.querySelector('.btn-label, .oauth-label') || btn;
  const spinner = btn.querySelector('.btn-spinner');

  if (loading){
    if (!ORIG_LABEL.has(btn)) ORIG_LABEL.set(btn, labelEl.textContent);
    labelEl.textContent = loadingLabel;
    btn.disabled = true;
    if (spinner) spinner.style.display = 'block';
  } else {
    if (ORIG_LABEL.has(btn)) labelEl.textContent = ORIG_LABEL.get(btn);
    btn.disabled = false;
    if (spinner) spinner.style.display = 'none';
  }
}
