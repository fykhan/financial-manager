// ui.js — modal, toast, and confirm helpers

const backdrop = () => document.getElementById('modal-backdrop');
const modalTitle = () => document.getElementById('modal-title');
const modalBody = () => document.getElementById('modal-body');

let onCloseCb = null;
let lastFocused = null;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function openModal(title, bodyHtml, { onClose } = {}) {
  lastFocused = document.activeElement;
  modalTitle().textContent = title;
  modalBody().innerHTML = bodyHtml;
  backdrop().hidden = false;
  onCloseCb = onClose || null;
  document.body.style.overflow = 'hidden';
  // Focus first field for fast input.
  const first = modalBody().querySelector('input, select, textarea, button');
  if (first) setTimeout(() => first.focus(), 40);
}

export function closeModal() {
  backdrop().hidden = true;
  modalBody().innerHTML = '';
  document.body.style.overflow = '';
  if (onCloseCb) { const cb = onCloseCb; onCloseCb = null; cb(); }
  if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  lastFocused = null;
}

/** Keep Tab focus cycling inside the open modal instead of leaking to the page behind it. */
function trapFocus(e) {
  if (e.key !== 'Tab' || backdrop().hidden) return;
  const modalEl = document.getElementById('modal');
  const nodes = [...modalEl.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
  if (!nodes.length) return;
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function initModalChrome() {
  document.getElementById('modal-close').addEventListener('click', closeModal);
  backdrop().addEventListener('click', e => { if (e.target === backdrop()) closeModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !backdrop().hidden) closeModal();
    else trapFocus(e);
  });
}

/** Toast with an optional inline action button (used for "Deleted · Undo"). */
export function toast(message, kind = '', { actionLabel, onAction, duration = 2600 } = {}) {
  const host = document.getElementById('toast-host');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;
  el.appendChild(text);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 300);
  };

  if (actionLabel && onAction) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => { dismiss(); onAction(); });
    el.appendChild(btn);
  }

  host.appendChild(el);
  setTimeout(dismiss, duration);
  return { dismiss };
}

/** Promise-based confirm dialog rendered inside the modal host. */
export function confirmDialog(title, message, { danger = true, okLabel = 'Confirm' } = {}) {
  return new Promise(resolve => {
    openModal(title, `
      <p style="margin-top:0;color:var(--text-2)">${message}</p>
      <div class="modal-actions">
        <button class="btn" data-act="cancel">Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${okLabel}</button>
      </div>
    `, { onClose: () => resolve(false) });
    modalBody().querySelector('[data-act="cancel"]').addEventListener('click', () => { closeModal(); });
    modalBody().querySelector('[data-act="ok"]').addEventListener('click', () => {
      onCloseGuard();
      resolve(true);
    });
  });
  function onCloseGuard() { backdrop().hidden = true; modalBody().innerHTML = ''; document.body.style.overflow = ''; onCloseCb = null; }
}

/** Trigger a file download in the browser. */
export function download(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
