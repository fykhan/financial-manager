// app.js — main controller: routing, wiring, data menu

import * as store from './store.js';
import { setCurrency, CURRENCIES, todayISO, escapeHtml, money, dateLabel } from './format.js';
import { initModalChrome, openModal, closeModal, toast, confirmDialog, download } from './ui.js';
import { openForm, hasForm, openAdjustBalance, deleteRecord } from './forms.js';
import { dueSoon, nextOccurrence } from './calc.js';
import {
  viewTitle, renderDashboard, renderTransactions, renderIncome, renderExpenses,
  renderInstallments, renderSubscriptions, renderSavings, renderAccounts, renderDebts,
  renderStatement, setStatementPreset, setStatementRange, stepStatementMonth, statementCSV, statementFilename, statementDocument,
  setStatementFilter, clearStatementFilter, toggleStatementChip, setStatementGroupAll,
  setAccountFilter, clearAccountFilter, setTxnFilter, clearTxnFilter, renderDrillDown, drillDownTitle,
  keywordChips, dropKeyword,
  toggleSelect, selectAll, clearSelection, clearAllSelections, getSelectedIds,
  setPage, resetPage, resetAllPages, LIST_FRAGMENTS, setSpendMode,
  renderGuide, loadGuide, guideLoaded,
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
  guide: renderGuide,
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
  // "+ Add" only on views that have an add form (not dashboard/statement/guide).
  document.getElementById('btn-add-primary').style.display = hasForm(current) ? '' : 'none';

  // Due-soon count badge on the Dashboard nav items (sidebar + bottom nav).
  updateDueBadges(dueSoon(data, 3).length);

  // The guide loads its markdown lazily, then re-renders once it's ready.
  if (current === 'guide' && !guideLoaded()) {
    loadGuide().then(() => { if (current === 'guide') render(); });
  }
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
  clearStatementFilter();
  clearAllSelections();
  resetAllPages();
  current = view;
  location.hash = view;
  render();
  closeSidebar();
  document.getElementById('view-container').scrollIntoView({ block: 'start' });
}

// ---------- theme ----------
const THEME_ORDER = ['dark', 'light', 'bauhaus', 'handdrawn', 'neumorphism', 'maximalism'];
const THEME_COLOR = { dark: '#0a0a0f', light: '#f2f4f3', bauhaus: '#f0f0f0', handdrawn: '#fdfbf7', neumorphism: '#e0e5ec', maximalism: '#0d0d1a' };
function applyTheme(mode) {
  document.documentElement.dataset.theme = mode;
  localStorage.setItem('gradplan.theme', mode);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[mode] || THEME_COLOR.dark);
}
function toggleTheme() {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(document.documentElement.dataset.theme) + 1) % THEME_ORDER.length];
  applyTheme(next);
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

// ---------- keyword search ----------
/** Put the caret back in a search box after its view re-rendered under it. */
function refocusSearch(scope, caret) {
  const el = document.querySelector(`[data-kw-search="${scope}"]`);
  if (!el) return;
  el.focus();
  if (caret != null) { try { el.setSelectionRange(caret, caret); } catch { /* type doesn't support it */ } }
}

/**
 * Apply a keyword query and refresh the smallest thing that can show it: the
 * ledger patches just its list fragment + chips (so typing never loses focus),
 * the statement needs a full render since its totals and panels all move.
 */
function applySearch(scope, value, caret) {
  if (scope === 'statement') {
    setStatementFilter({ text: value });
    render();
    refocusSearch('statement', caret);
    return;
  }
  setTxnFilter({ text: value });
  resetPage('txn-accounts');
  const list = document.getElementById('list-txn-accounts');
  if (list) list.innerHTML = LIST_FRAGMENTS['txn-accounts'](store.getData());
  const chips = document.getElementById('kw-chips-txn');
  if (chips) chips.innerHTML = keywordChips('txn');
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
    if (hasForm(current)) openForm(current);
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
    const adjustBalanceBtn = e.target.closest('[data-adjust-balance]');
    const accountCard = e.target.closest('[data-account-card]');

    // Order matters: edit/delete/select controls are nested inside the
    // clickable account card, so they must be checked before it.
    if (editBtn) return openForm(editBtn.dataset.edit, editBtn.dataset.id);
    if (delBtn) {
      await deleteRecord(delBtn.dataset.del, delBtn.dataset.id);
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
    const recapBtn = e.target.closest('[data-recap-statement]');
    if (recapBtn) { setStatementPreset(recapBtn.dataset.recapStatement || 'last-month'); return navigate('statement'); }
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
        prefill: {
          type: 'expense',
          amount: item.amount,
          description: item.name,
          date: todayISO(),
          category: item.category || (item.kind === 'installment' ? 'Debt & loans' : 'Other'),
        },
        // On save, roll the source record's next-due date forward one cycle.
        onSaved: async () => {
          if (!store.getById(collection, id)) return;
          await store.update(collection, id, { [item.dateField]: nextOccurrence(item.date, item.frequency) });
        },
      });
    }
    const kwDropBtn = e.target.closest('[data-kw-drop]');
    if (kwDropBtn) {
      const [scope, index] = kwDropBtn.dataset.kwDrop.split(':');
      dropKeyword(scope, parseInt(index, 10));
      if (scope === 'txn') resetPage('txn-accounts');
      return render();
    }
    if (e.target.closest('[data-statement-filter-clear]')) { clearStatementFilter(); return render(); }
    const statementChip = e.target.closest('[data-statement-chip]');
    if (statementChip) {
      // group:value — split on the FIRST colon only, since a category name can contain one.
      const raw = statementChip.dataset.statementChip;
      const i = raw.indexOf(':');
      toggleStatementChip(raw.slice(0, i), raw.slice(i + 1));
      return render();
    }
    if (statementPresetBtn) { setStatementPreset(statementPresetBtn.dataset.statementPreset); return render(); }
    const statementStepBtn = e.target.closest('[data-statement-step]');
    if (statementStepBtn) { stepStatementMonth(parseInt(statementStepBtn.dataset.statementStep, 10)); return render(); }
    if (statementExportBtn) {
      if (statementExportBtn.dataset.statementExport === 'csv') {
        download(`gradplan-statement-${statementFilename(store.getData())}.csv`, statementCSV(store.getData()), 'text/csv');
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
      // Cascade collections (debts here) also take their transactions with them.
      if (store.CASCADE_COLLECTIONS.includes(collection)) {
        try {
          const snapshots = [];
          for (const id of ids) { const s = await store.removeCascade(collection, id); if (s) snapshots.push(s); }
          clearSelection(collection);
          toast(`Deleted ${snapshots.length} item${snapshots.length === 1 ? '' : 's'}`, '', {
            actionLabel: 'Undo', duration: 6000,
            onAction: () => snapshots.forEach(s => store.restoreCascade(s)),
          });
        } catch { /* store.js already toasted */ }
        return;
      }
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
    // The explicit filter/adjust buttons are checked before the whole-card click (they're nested inside).
    if (adjustBalanceBtn) return openAdjustBalance(adjustBalanceBtn.dataset.adjustBalance);
    if (accountFilterBtn) { setAccountFilter(accountFilterBtn.dataset.accountFilter); return render(); }
    if (accountCard) { setAccountFilter(accountCard.dataset.accountCard); return render(); }
  });

  // Statement date pickers + Transactions account filter fire 'change', not 'click'.
  document.getElementById('view-container').addEventListener('change', e => {
    const txnAccount = e.target.closest('[data-txn-account]');
    if (txnAccount) { setTxnFilter({ accountId: txnAccount.value }); resetPage('txn-accounts'); return render(); }

    const statementAll = e.target.closest('[data-statement-all]');
    if (statementAll) {
      setStatementGroupAll(store.getData(), statementAll.dataset.statementAll, statementAll.checked);
      return render();
    }

    const dateInput = e.target.closest('[data-statement-date]');
    if (!dateInput) return;
    const from = document.querySelector('[data-statement-date="from"]')?.value || '';
    const to = document.querySelector('[data-statement-date="to"]')?.value || '';
    setStatementRange(from, to);
    render();
  });

  // Line chart hover: snap to the nearest day (the chart has one point per day).
  const chartHover = (e, hide) => {
    const box = e.target.closest?.('.linechart');
    document.querySelectorAll('.linechart').forEach(c => {
      if (c === box && !hide) return;
      c.querySelector('.lc-cursor').style.display = 'none';
      c.querySelector('.lc-dot').style.display = 'none';
      c.querySelector('.lc-tip').style.display = 'none';
    });
    if (!box || hide) return;
    const svg = box.querySelector('svg');
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const pts = JSON.parse(box.dataset.pts);
    const cx = ((e.clientX - rect.left) / rect.width) * Number(box.dataset.w);
    let best = pts[0];
    for (const p of pts) if (Math.abs(p[0] - cx) < Math.abs(best[0] - cx)) best = p;
    const [vx, cy, date, bal, opening] = best;
    const label = opening ? 'Opening balance' : dateLabel(date);
    const cursor = box.querySelector('.lc-cursor');
    cursor.setAttribute('x1', vx); cursor.setAttribute('x2', vx);
    cursor.style.display = '';
    const dot = box.querySelector('.lc-dot');
    dot.setAttribute('cx', vx); dot.setAttribute('cy', cy);
    dot.style.display = '';
    const tip = box.querySelector('.lc-tip');
    tip.innerHTML = `<div style="color:var(--muted)">${escapeHtml(label)}</div><strong>${escapeHtml(money(bal))}</strong>`;
    tip.style.display = '';
    const px = (vx / Number(box.dataset.w)) * rect.width;
    const py = (cy / Number(box.dataset.h)) * rect.height;
    const flip = px + tip.offsetWidth + 16 > rect.width;
    tip.style.left = `${flip ? px - tip.offsetWidth - 12 : px + 12}px`;
    tip.style.top = `${Math.max(0, py - tip.offsetHeight - 8)}px`;
  };
  const viewEl = document.getElementById('view-container');
  viewEl.addEventListener('pointermove', e => chartHover(e, false));
  viewEl.addEventListener('pointerleave', e => chartHover(e, true));

  // Keyword search, shared by the Transactions ledger and the Statement.
  // Debounced either way; how the result is applied differs by scope:
  //  - txn: patch ONLY the list fragment so the input keeps focus (a full
  //    render would blow away the field mid-type).
  //  - statement: no list fragment to patch, so it takes a full render and
  //    puts the caret back where it was.
  let searchTimer;
  document.getElementById('view-container').addEventListener('input', e => {
    const search = e.target.closest('[data-kw-search]');
    if (!search) return;
    const scope = search.dataset.kwSearch;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applySearch(scope, search.value, search.selectionStart), 220);
  });

  // Re-render whenever the store changes.
  store.subscribe(render);

  // Hash routing (back/forward + deep links)
  window.addEventListener('hashchange', () => {
    const v = location.hash.replace('#', '');
    if (RENDERERS[v] && v !== current) { clearAccountFilter(); clearTxnFilter(); clearStatementFilter(); current = v; render(); }
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
      // Focus the search on whichever view has one; otherwise go to the ledger.
      if (!document.querySelector('[data-kw-search]')) navigate('transactions');
      document.querySelector('[data-kw-search]')?.focus();
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
