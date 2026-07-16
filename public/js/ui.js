// ui.js — modal, toast, and confirm helpers

const backdrop = () => document.getElementById('modal-backdrop');
const modalTitle = () => document.getElementById('modal-title');
const modalBody = () => document.getElementById('modal-body');

let onCloseCb = null;

export function openModal(title, bodyHtml, { onClose } = {}) {
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
}

export function initModalChrome() {
  document.getElementById('modal-close').addEventListener('click', closeModal);
  backdrop().addEventListener('click', e => { if (e.target === backdrop()) closeModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !backdrop().hidden) closeModal();
  });
}

export function toast(message, kind = '') {
  const host = document.getElementById('toast-host');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 300);
  }, 2600);
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
