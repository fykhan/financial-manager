// app.js — main controller: routing, wiring, data menu

import * as store from './store.js';
import { setCurrency, CURRENCIES, todayISO } from './format.js';
import { initModalChrome, openModal, closeModal, toast, confirmDialog, download } from './ui.js';
import { openForm } from './forms.js';
import {
  viewTitle, renderDashboard, renderIncome, renderExpenses,
  renderInstallments, renderSubscriptions, renderSavings, renderAccounts, renderDebts,
  setAccountFilter, clearAccountFilter, renderDrillDown, drillDownTitle,
  toggleSelect, selectAll, clearSelection, clearAllSelections, getSelectedIds,
  setPage, resetAllPages, LIST_FRAGMENTS, setSpendMode,
} from './views.js';

const RENDERERS = {
  dashboard: renderDashboard,
  income: renderIncome,
  expenses: renderExpenses,
  installments: renderInstallments,
  subscriptions: renderSubscriptions,
  savings: renderSavings,
  accounts: renderAccounts,
  debts: renderDebts,
};

let current = 'dashboard';

// ---------- render ----------
function render() {
  const data = store.getData();
  document.getElementById('view-title').textContent = viewTitle(current);
  document.getElementById('view-container').innerHTML = RENDERERS[current](data);

  // Sync nav highlight
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.setAttribute('aria-current', btn.dataset.view === current ? 'true' : 'false');
  });
  // "+ Add" button only where a collection is active
  document.getElementById('btn-add-primary').style.display = current === 'dashboard' ? 'none' : '';
}

function navigate(view) {
  if (!RENDERERS[view]) return;
  clearAccountFilter();
  clearAllSelections();
  resetAllPages();
  current = view;
  location.hash = view;
  render();
  closeSidebar();
  document.getElementById('view-container').scrollIntoView({ block: 'start' });
}

// ---------- theme ----------
function applyTheme(mode) {
  document.documentElement.dataset.theme = mode;
  localStorage.setItem('gradplan.theme', mode);
}
function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  render();
}

// ---------- currency ----------
function initCurrency() {
  const sel = document.getElementById('currency-select');
  sel.innerHTML = CURRENCIES.map(c => `<option value="${c.code}">${c.code} ${c.symbol}</option>`).join('');
  const saved = store.getSettings().currency || 'USD';
  sel.value = saved;
  setCurrency(saved);
  sel.addEventListener('change', () => {
    setCurrency(sel.value);
    store.updateSettings({ currency: sel.value });
    render();
  });
}

// ---------- data menu (import / export / reset) ----------
function openDataMenu() {
  openModal('Your data', `
    <p class="text-muted" style="margin-top:0;font-size:13.5px">Your data lives in your account on the server. Back it up or move it to another device below.</p>
    <div style="display:flex;flex-direction:column;gap:10px">
      <button class="btn btn-block" data-data="export-json">⬇ Export backup (JSON)</button>
      <button class="btn btn-block" data-data="export-csv">⬇ Export spreadsheet (CSV)</button>
      <button class="btn btn-block" data-data="import">⬆ Import backup (JSON)</button>
      <button class="btn btn-block" data-data="print">🖨 Print / save as PDF</button>
      <hr style="border:none;border-top:1px solid var(--border);margin:6px 0">
      <button class="btn btn-block" data-data="sample">↺ Load sample data</button>
      <button class="btn btn-block btn-danger" data-data="reset">🗑 Erase everything</button>
    </div>
    <input type="file" id="import-file" accept="application/json,.json" hidden>
  `);

  const body = document.getElementById('modal-body');
  body.addEventListener('click', async e => {
    const act = e.target.closest('[data-data]')?.dataset.data;
    if (!act) return;
    if (act === 'export-json') {
      download(`gradplan-backup-${todayISO()}.json`, store.exportJSON(), 'application/json');
      toast('Backup downloaded', 'good');
    } else if (act === 'export-csv') {
      download(`gradplan-${todayISO()}.csv`, store.exportCSV(), 'text/csv');
      toast('CSV downloaded', 'good');
    } else if (act === 'print') {
      closeModal(); setTimeout(() => window.print(), 200);
    } else if (act === 'import') {
      document.getElementById('import-file').click();
    } else if (act === 'sample') {
      if (await confirmDialog('Load sample data?', 'This replaces your current data with an example budget.', { okLabel: 'Load sample', danger: false })) {
        try { await store.loadSample(); toast('Sample data loaded', 'good'); closeModal(); render(); } catch { /* store.js already toasted */ }
      }
    } else if (act === 'reset') {
      if (await confirmDialog('Erase everything?', 'All your income, expenses, installments, subscriptions and savings will be permanently deleted.', { okLabel: 'Erase all' })) {
        try { await store.resetAll(); toast('All data erased', ''); closeModal(); render(); } catch { /* store.js already toasted */ }
      }
    }
  });

  document.getElementById('import-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await store.importJSON(reader.result);
        const sel = document.getElementById('currency-select');
        sel.value = store.getSettings().currency || 'USD';
        setCurrency(sel.value);
        toast('Backup imported', 'good');
        closeModal(); render();
      } catch {
        /* store.js already toasted the failure */
      }
    };
    reader.readAsText(file);
  });
}

// ---------- sidebar (mobile) ----------
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); }

// ---------- logout ----------
async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch { /* ignore */ }
  location.href = '/login.html';
}

// ---------- global event delegation ----------
function wire() {
  document.getElementById('nav').addEventListener('click', e => {
    const btn = e.target.closest('.nav-item');
    if (btn) navigate(btn.dataset.view);
  });

  document.getElementById('btn-add-primary').addEventListener('click', () => {
    if (current !== 'dashboard') openForm(current);
  });

  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  document.getElementById('btn-data').addEventListener('click', openDataMenu);
  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Delegated actions inside the view container (edit / delete / add / empty-state add)
  document.getElementById('view-container').addEventListener('click', async e => {
    const editBtn = e.target.closest('[data-edit]');
    const delBtn = e.target.closest('[data-del]');
    const addBtn = e.target.closest('[data-add]');
    const drillBtn = e.target.closest('[data-drill]');
    const clearFilterBtn = e.target.closest('[data-clear-account-filter]');
    const spendModeBtn = e.target.closest('[data-spend-mode]');
    const selectAllBox = e.target.closest('[data-select-all]');
    const selectBox = e.target.closest('[data-select]');
    const bulkDeleteBtn = e.target.closest('[data-bulk-delete]');
    const pageNavBtn = e.target.closest('[data-page-nav]');
    const accountCard = e.target.closest('[data-account-card]');

    // Order matters: edit/delete/select controls are nested inside the
    // clickable account card, so they must be checked before it.
    if (editBtn) return openForm(editBtn.dataset.edit, editBtn.dataset.id);
    if (delBtn) {
      const { collection, id } = { collection: delBtn.dataset.del, id: delBtn.dataset.id };
      const rec = store.getById(collection, id);
      const name = rec?.name || rec?.source || rec?.description || rec?.category || rec?.person || 'this item';
      if (await confirmDialog('Delete?', `Remove “${name}”? This can't be undone.`)) {
        try { await store.remove(collection, id); toast('Deleted', ''); } catch { /* store.js already toasted */ }
      }
      return;
    }
    if (addBtn) return openForm(addBtn.dataset.add);
    if (drillBtn) {
      const key = drillBtn.dataset.drill;
      return openModal(drillDownTitle(key), renderDrillDown(key, store.getData()));
    }
    if (clearFilterBtn) { clearAccountFilter(); return render(); }
    if (spendModeBtn) { setSpendMode(spendModeBtn.dataset.spendMode); return render(); }
    if (selectAllBox) {
      const collection = selectAllBox.dataset.selectAll;
      const prefix = `${collection}:`;
      const ids = [...document.querySelectorAll('[data-select^="' + prefix + '"]')]
        .map(el => el.dataset.select.slice(prefix.length));
      selectAll(collection, ids, selectAllBox.checked);
      return render();
    }
    if (selectBox) {
      const [collection, id] = selectBox.dataset.select.split(':');
      toggleSelect(collection, id);
      return render();
    }
    if (bulkDeleteBtn) {
      const collection = bulkDeleteBtn.dataset.bulkDelete;
      const ids = getSelectedIds(collection);
      if (!ids.length) return;
      if (await confirmDialog('Delete selected?', `Remove ${ids.length} item${ids.length === 1 ? '' : 's'}? This can't be undone.`)) {
        try {
          await Promise.all(ids.map(id => store.remove(collection, id)));
          clearSelection(collection);
          toast('Deleted', '');
        } catch { /* store.js already toasted individual failures */ }
      }
      return;
    }
    if (pageNavBtn) {
      // Patches only this list's own container — not a full page render.
      const [key, pageStr] = pageNavBtn.dataset.pageNav.split(':');
      setPage(key, parseInt(pageStr, 10));
      const container = document.getElementById(`list-${key}`);
      const renderFragment = LIST_FRAGMENTS[key];
      if (container && renderFragment) container.innerHTML = renderFragment(store.getData());
      return;
    }
    if (accountCard) { setAccountFilter(accountCard.dataset.accountCard); return render(); }
  });

  // Re-render whenever the store changes.
  store.subscribe(render);

  // Hash routing (back/forward + deep links)
  window.addEventListener('hashchange', () => {
    const v = location.hash.replace('#', '');
    if (RENDERERS[v] && v !== current) { clearAccountFilter(); current = v; render(); }
  });
}

// ---------- boot ----------
async function boot() {
  applyTheme(localStorage.getItem('gradplan.theme') || 'dark');
  initModalChrome();
  wire();
  try {
    await store.init();
  } catch {
    return; // api.js already redirected to /login.html on 401
  }
  initCurrency();
  const hashView = location.hash.replace('#', '');
  current = RENDERERS[hashView] ? hashView : 'dashboard';
  render();
}

boot();
