// app.js — main controller: routing, wiring, data menu

import * as store from './store.js';
import { setCurrency, CURRENCIES, todayISO } from './format.js';
import { initModalChrome, openModal, closeModal, toast, confirmDialog, download } from './ui.js';
import { openForm } from './forms.js';
import { dueSoon, nextOccurrence } from './calc.js';
import {
  viewTitle, renderDashboard, renderTransactions, renderIncome, renderExpenses,
  renderInstallments, renderSubscriptions, renderSavings, renderAccounts, renderDebts,
  renderStatement, setStatementPreset, setStatementRange, stepStatementMonth, statementCSV, statementFilename, statementDocument,
  setAccountFilter, clearAccountFilter, setTxnFilter, clearTxnFilter, renderDrillDown, drillDownTitle,
  toggleSelect, selectAll, clearSelection, clearAllSelections, getSelectedIds,
  setPage, resetPage, resetAllPages, LIST_FRAGMENTS, setSpendMode,
} from './views.js';

const RENDERERS = {
  dashboard: renderDashboard,
  transactions: renderTransactions,
  income: renderIncome,
  expenses: renderExpenses,
  installments: renderInstallments,
  subscriptions: renderSubscriptions,
  savings: renderSavings,
  accounts: renderAccounts,
  debts: renderDebts,
  statement: renderStatement,
};

let current = 'dashboard';

// ---------- render ----------
function render() {
  const data = store.getData();
  document.getElementById('view-title').textContent = viewTitle(current);
  document.getElementById('view-container').innerHTML = RENDERERS[current](data);

  // Sync nav highlight (sidebar + bottom tab bar)
  document.querySelectorAll('.nav-item, .bottom-nav-item[data-view]').forEach(btn => {
    btn.setAttribute('aria-current', btn.dataset.view === current ? 'true' : 'false');
  });
  // "+ Add" button only where a collection is active; "+ Log" is always shown.
  document.getElementById('btn-add-primary').style.display = current === 'dashboard' ? 'none' : '';

  // Due-soon count badge on the Dashboard nav items (sidebar + bottom nav).
  updateDueBadges(dueSoon(data, 3).length);
}

// A collection can surface in more than one list fragment on a page (a
// transactions selection shows in the accounts/savings/debts ledgers).
const FRAGMENT_KEYS_FOR = { transactions: ['txn-accounts', 'txn-savings', 'txn-debts'] };

/** Re-render only the list fragment(s) for a collection that are on the page.
 * Returns false if none were found (caller should fall back to full render). */
function patchLists(collection) {
  const keys = FRAGMENT_KEYS_FOR[collection] || [collection];
  let patched = false;
  keys.forEach(key => {
    const container = document.getElementById(`list-${key}`);
    const frag = LIST_FRAGMENTS[key];
    if (container && frag) { container.innerHTML = frag(store.getData()); patched = true; }
  });
  return patched;
}

/** Show/update a small count badge on every Dashboard nav item. */
function updateDueBadges(count) {
  document.querySelectorAll('[data-view="dashboard"]').forEach(item => {
    let badge = item.querySelector('.nav-badge');
    if (count > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'nav-badge'; item.appendChild(badge); }
      badge.textContent = count;
      badge.setAttribute('aria-label', `${count} due soon`);
    } else if (badge) {
      badge.remove();
    }
  });
}

function navigate(view) {
  if (!RENDERERS[view]) return;
  clearAccountFilter();
  clearTxnFilter();
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

// ---------- effects (per-device visual intensity) ----------
function applyEffects(mode) {
  document.documentElement.dataset.effects = mode;
  localStorage.setItem('gradplan.effects', mode);
}
function toggleEffects() {
  applyEffects(document.documentElement.dataset.effects === 'subtle' ? 'on' : 'subtle');
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
    <p class="text-muted" style="margin-top:0;font-size:13.5px">Your data lives in your account on the server. Back it up or move it to another device below. Amounts are stored and exported in their original currency — the display currency only changes the symbol, it doesn't convert values.</p>
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
    <p class="text-muted" style="font-size:12px;margin:14px 0 0;letter-spacing:0.02em">
      Keyboard: <strong>n</strong> new transaction · <strong>/</strong> search · <strong>g</strong> then <strong>d</strong>/<strong>t</strong>/<strong>a</strong>/<strong>s</strong> to jump to a view.
    </p>
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

// ---------- statement PDF (standalone document) ----------
// Render the self-contained statement HTML into an off-screen iframe and print
// just that document, so the PDF is a clean bank statement rather than a
// screenshot of the app page (which would carry the app's theme and chrome).
function printStatementDocument(html) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);

  const cleanup = () => frame.remove();
  frame.contentWindow.addEventListener('afterprint', cleanup);

  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  // Give the iframe a tick to lay out before invoking print; fall back to
  // removing it after a while in case afterprint never fires (some browsers).
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(cleanup, 60000);
  }, 150);
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

  // Always-available quick-add for a transaction, from any view (topbar + mobile FAB + bottom nav).
  const quickLog = () => openForm('transactions');
  document.getElementById('btn-log-txn').addEventListener('click', quickLog);
  document.getElementById('fab-log').addEventListener('click', quickLog);
  document.getElementById('bnav-log').addEventListener('click', quickLog);

  // Mobile bottom tab bar: view tabs navigate, "More" opens the sidebar sheet.
  document.getElementById('bottom-nav').addEventListener('click', e => {
    const viewBtn = e.target.closest('.bottom-nav-item[data-view]');
    if (viewBtn) navigate(viewBtn.dataset.view);
  });
  document.getElementById('bnav-more').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  document.getElementById('btn-theme').addEventListener('click', toggleTheme);
  document.getElementById('btn-effects').addEventListener('click', toggleEffects);
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
    const statementPresetBtn = e.target.closest('[data-statement-preset]');
    const statementExportBtn = e.target.closest('[data-statement-export]');
    const selectAllBox = e.target.closest('[data-select-all]');
    const selectBox = e.target.closest('[data-select]');
    const bulkDeleteBtn = e.target.closest('[data-bulk-delete]');
    const pageNavBtn = e.target.closest('[data-page-nav]');
    const accountFilterBtn = e.target.closest('[data-account-filter]');
    const accountCard = e.target.closest('[data-account-card]');

    // Order matters: edit/delete/select controls are nested inside the
    // clickable account card, so they must be checked before it.
    if (editBtn) return openForm(editBtn.dataset.edit, editBtn.dataset.id);
    if (delBtn) {
      const { collection, id } = { collection: delBtn.dataset.del, id: delBtn.dataset.id };
      const rec = store.getById(collection, id);
      if (!rec) return;
      const name = rec.name || rec.source || rec.description || rec.category || rec.person || 'item';
      try {
        await store.remove(collection, id);
        toast(`Deleted “${name}”`, '', { actionLabel: 'Undo', duration: 6000, onAction: () => store.restore(collection, rec) });
      } catch { /* store.js already toasted */ }
      return;
    }
    if (addBtn) {
      let prefill = null;
      if (addBtn.dataset.addPrefill) { try { prefill = JSON.parse(addBtn.dataset.addPrefill); } catch { /* ignore */ } }
      return openForm(addBtn.dataset.add, null, { prefill });
    }
    if (drillBtn) {
      const key = drillBtn.dataset.drill;
      return openModal(drillDownTitle(key), renderDrillDown(key, store.getData()));
    }
    if (clearFilterBtn) { clearAccountFilter(); return render(); }
    if (spendModeBtn) { setSpendMode(spendModeBtn.dataset.spendMode); return render(); }
    const txnCatBtn = e.target.closest('[data-txn-cat]');
    if (txnCatBtn) { setTxnFilter({ category: txnCatBtn.dataset.txnCat }); resetPage('txn-accounts'); return render(); }
    if (e.target.closest('[data-recap-statement]')) { setStatementPreset('last-month'); return navigate('statement'); }
    const onboardBtn = e.target.closest('[data-onboard]');
    if (onboardBtn) {
      if (onboardBtn.dataset.onboard === 'dismiss') { localStorage.setItem('gradplan.onboardDismiss', '1'); return render(); }
      if (onboardBtn.dataset.onboard === 'sample') {
        try { await store.loadSample(); toast('Sample data loaded', 'good'); } catch { /* store.js toasted */ }
        return;
      }
    }
    const markPaidBtn = e.target.closest('[data-mark-paid]');
    if (markPaidBtn) {
      const [kind, id] = markPaidBtn.dataset.markPaid.split(':');
      const item = dueSoon(store.getData()).find(i => i.kind === kind && i.id === id);
      if (!item) return;
      const collection = { subscription: 'subscriptions', expense: 'expenses', installment: 'installments' }[kind];
      return openForm('transactions', null, {
        prefill: { type: 'expense', amount: item.amount, description: item.name, date: todayISO(), category: item.category || '' },
        // On save, roll the source record's next-due date forward one cycle.
        onSaved: async () => {
          if (!store.getById(collection, id)) return;
          await store.update(collection, id, { [item.dateField]: nextOccurrence(item.date, item.frequency) });
        },
      });
    }
    if (statementPresetBtn) { setStatementPreset(statementPresetBtn.dataset.statementPreset); return render(); }
    const statementStepBtn = e.target.closest('[data-statement-step]');
    if (statementStepBtn) { stepStatementMonth(parseInt(statementStepBtn.dataset.statementStep, 10)); return render(); }
    if (statementExportBtn) {
      if (statementExportBtn.dataset.statementExport === 'csv') {
        download(`gradplan-statement-${statementFilename()}.csv`, statementCSV(store.getData()), 'text/csv');
        toast('Statement CSV downloaded', 'good');
      } else {
        printStatementDocument(statementDocument(store.getData()));
      }
      return;
    }
    if (selectAllBox) {
      const collection = selectAllBox.dataset.selectAll;
      const prefix = `${collection}:`;
      const ids = [...document.querySelectorAll('[data-select^="' + prefix + '"]')]
        .map(el => el.dataset.select.slice(prefix.length));
      selectAll(collection, ids, selectAllBox.checked);
      // Patch just the affected list(s) — a full render() would jump the scroll.
      if (!patchLists(collection)) render();
      return;
    }
    if (selectBox) {
      const [collection, id] = selectBox.dataset.select.split(':');
      toggleSelect(collection, id);
      if (!patchLists(collection)) render();
      return;
    }
    if (bulkDeleteBtn) {
      const collection = bulkDeleteBtn.dataset.bulkDelete;
      const ids = getSelectedIds(collection);
      if (!ids.length) return;
      const snapshot = ids.map(id => store.getById(collection, id)).filter(Boolean);
      try {
        await Promise.all(ids.map(id => store.remove(collection, id)));
        clearSelection(collection);
        toast(`Deleted ${snapshot.length} item${snapshot.length === 1 ? '' : 's'}`, '', {
          actionLabel: 'Undo', duration: 6000,
          onAction: () => snapshot.forEach(rec => store.restore(collection, rec)),
        });
      } catch { /* store.js already toasted individual failures */ }
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
    // The explicit filter button is checked before the whole-card click (it's nested inside).
    if (accountFilterBtn) { setAccountFilter(accountFilterBtn.dataset.accountFilter); return render(); }
    if (accountCard) { setAccountFilter(accountCard.dataset.accountCard); return render(); }
  });

  // Statement date pickers + Transactions account filter fire 'change', not 'click'.
  document.getElementById('view-container').addEventListener('change', e => {
    const txnAccount = e.target.closest('[data-txn-account]');
    if (txnAccount) { setTxnFilter({ accountId: txnAccount.value }); resetPage('txn-accounts'); return render(); }

    const dateInput = e.target.closest('[data-statement-date]');
    if (!dateInput) return;
    const from = document.querySelector('[data-statement-date="from"]')?.value || '';
    const to = document.querySelector('[data-statement-date="to"]')?.value || '';
    setStatementRange(from, to);
    render();
  });

  // Ledger search: debounced, and patches ONLY the list fragment so the input
  // keeps focus (a full render would blow away the field mid-type).
  let txnSearchTimer;
  document.getElementById('view-container').addEventListener('input', e => {
    const search = e.target.closest('[data-txn-search]');
    if (!search) return;
    clearTimeout(txnSearchTimer);
    txnSearchTimer = setTimeout(() => {
      setTxnFilter({ text: search.value });
      resetPage('txn-accounts');
      const container = document.getElementById('list-txn-accounts');
      if (container) container.innerHTML = LIST_FRAGMENTS['txn-accounts'](store.getData());
    }, 200);
  });

  // Re-render whenever the store changes.
  store.subscribe(render);

  // Hash routing (back/forward + deep links)
  window.addEventListener('hashchange', () => {
    const v = location.hash.replace('#', '');
    if (RENDERERS[v] && v !== current) { clearAccountFilter(); clearTxnFilter(); current = v; render(); }
  });

  wireKeyboardShortcuts();
}

// ---------- keyboard shortcuts ----------
// n = quick-add txn, / = focus ledger search, g then d/t/a/s = jump to view.
function wireKeyboardShortcuts() {
  let gPending = false, gTimer;
  const GO = { d: 'dashboard', t: 'transactions', a: 'accounts', s: 'statement' };
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = document.activeElement;
    const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    const modalOpen = !document.getElementById('modal-backdrop').hidden;
    if (typing || modalOpen) return;

    if (gPending) {
      gPending = false; clearTimeout(gTimer);
      if (GO[e.key]) { e.preventDefault(); navigate(GO[e.key]); }
      return;
    }
    if (e.key === 'g') { gPending = true; gTimer = setTimeout(() => { gPending = false; }, 1200); return; }
    if (e.key === 'n') { e.preventDefault(); openForm('transactions'); return; }
    if (e.key === '/') {
      e.preventDefault();
      if (current !== 'transactions') navigate('transactions');
      document.querySelector('[data-txn-search]')?.focus();
    }
  });
}

// ---------- boot ----------
async function boot() {
  applyTheme(localStorage.getItem('gradplan.theme') || 'dark');
  applyEffects(localStorage.getItem('gradplan.effects') || 'subtle');
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
