// store.js — data model, persistence (FastAPI + Neon backend), import/export

import { get, post, patch as apiPatch, del } from './api.js';
import { toast } from './ui.js';

const emptyData = () => ({
  version: 1,
  settings: { currency: 'USD', name: '' },
  income: [],
  expenses: [],
  installments: [],
  subscriptions: [],
  savings: [],
  accounts: [],
  transactions: [],
  budgets: [],
  debts: [],
});

const listeners = new Set();
let data = emptyData();

function uid() {
  return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function notify() { listeners.forEach(fn => fn(data)); }

function normalize(parsed) {
  const base = emptyData();
  return {
    ...base,
    ...parsed,
    settings: { ...base.settings, ...(parsed.settings || {}) },
    income: parsed.income || [],
    expenses: parsed.expenses || [],
    installments: parsed.installments || [],
    subscriptions: parsed.subscriptions || [],
    savings: parsed.savings || [],
    accounts: parsed.accounts || [],
    transactions: parsed.transactions || [],
    budgets: parsed.budgets || [],
    debts: parsed.debts || [],
  };
}

/** Apply a local change and notify synchronously, fire the write in the
 * background, and roll back + toast if the server rejects it. */
async function optimisticWrite(applyLocal, request, failMessage) {
  const prev = data;
  applyLocal();
  notify();
  try {
    await request();
  } catch (err) {
    data = prev;
    notify();
    toast(`${failMessage}: ${err.message}`, 'err');
    throw err;
  }
}

// ---- public API ----
export async function init() {
  data = normalize(await get('/api/data'));
}

export function getData() { return data; }
export function getSettings() { return data.settings; }

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function updateSettings(patchObj) {
  return optimisticWrite(
    () => { data = { ...data, settings: { ...data.settings, ...patchObj } }; },
    () => apiPatch('/api/settings', patchObj),
    'Could not save settings',
  );
}

const COLLECTIONS = ['income', 'expenses', 'installments', 'subscriptions', 'savings', 'accounts', 'transactions', 'budgets', 'debts'];

export function add(collection, record) {
  if (!COLLECTIONS.includes(collection)) throw new Error('bad collection ' + collection);
  const rec = { ...record, id: uid(), createdAt: new Date().toISOString() };
  return optimisticWrite(
    () => { data = { ...data, [collection]: [...data[collection], rec] }; },
    () => post(`/api/${collection}`, rec),
    'Could not save',
  ).then(() => rec);
}

export function update(collection, id, patchObj) {
  const idx = data[collection].findIndex(r => r.id === id);
  if (idx === -1) return Promise.resolve(null);
  const updated = { ...data[collection][idx], ...patchObj, id };
  return optimisticWrite(
    () => {
      const list = [...data[collection]];
      list[idx] = updated;
      data = { ...data, [collection]: list };
    },
    () => apiPatch(`/api/${collection}/${id}`, patchObj),
    'Could not save',
  ).then(() => updated);
}

export function remove(collection, id) {
  return optimisticWrite(
    () => { data = { ...data, [collection]: data[collection].filter(r => r.id !== id) }; },
    () => del(`/api/${collection}/${id}`),
    'Could not delete',
  );
}

/** Re-add a record exactly as it was (same id, same createdAt) — for undoing
 * a delete. Ids are client-generated and POST upserts via session.merge on
 * the backend, so re-posting a just-deleted record is a clean restore. */
export function restore(collection, record) {
  if (!COLLECTIONS.includes(collection)) throw new Error('bad collection ' + collection);
  return optimisticWrite(
    () => { data = { ...data, [collection]: [...data[collection], record] }; },
    () => post(`/api/${collection}`, record),
    'Could not restore',
  ).then(() => record);
}

// ---- cascade delete ----
// Deleting an account/debt/saving would otherwise orphan the transactions that
// reference it (they'd render as "—" and drop out of balance math) and, for
// accounts, leave dangling auto-pay links that recurring.py keeps posting to.
// So these deletes cascade: the record's transactions go too, and any auto-pay
// link pointing at a deleted account is cleared. The backend mirrors this in
// delete_record (its own atomic cleanup), so the client only has to fire the
// single DELETE and update its cache to match.
export const CASCADE_COLLECTIONS = ['accounts', 'debts', 'savings'];

/** The transactions and auto-pay links that a cascade delete would remove.
 * Reads the current cache; used both for the impact preview and the delete. */
function collectDependents(collection, id) {
  const txns = data.transactions;
  let killedTxns = [];
  const clearedLinks = []; // { collection, record } — auto-pay sources to un-link
  if (collection === 'accounts') {
    killedTxns = txns.filter(t => t.accountId === id || t.toAccountId === id);
    ['income', 'expenses', 'subscriptions', 'installments'].forEach(c => {
      data[c].forEach(r => { if (r.accountId === id) clearedLinks.push({ collection: c, record: r }); });
    });
  } else if (collection === 'debts') {
    killedTxns = txns.filter(t => t.type === 'debt' && t.debtId === id);
  } else if (collection === 'savings') {
    killedTxns = txns.filter(t => t.savingId === id);
  }
  return { killedTxns, clearedLinks };
}

/** How much collateral a cascade delete would take — for a warning dialog. */
export function cascadeImpact(collection, id) {
  if (!CASCADE_COLLECTIONS.includes(collection)) return { txnCount: 0, linkCount: 0 };
  const { killedTxns, clearedLinks } = collectDependents(collection, id);
  return { txnCount: killedTxns.length, linkCount: clearedLinks.length };
}

/** Group records by collection and apply a per-record transform to the cache. */
function mapByCollection(next, links, transform) {
  const byCol = {};
  links.forEach(({ collection: c, record: r }) => { (byCol[c] ||= new Set()).add(r.id); });
  Object.entries(byCol).forEach(([c, ids]) => {
    next[c] = data[c].map(x => (ids.has(x.id) ? transform(x, c, ids) : x));
  });
}

/** Delete an account/debt/saving plus its transactions, clearing any auto-pay
 * links, as one undoable unit. The backend cascades server-side, so the only
 * request is the single DELETE; the local cache is updated to match. Resolves
 * to a snapshot that restoreCascade() reverses. */
export function removeCascade(collection, id) {
  if (!CASCADE_COLLECTIONS.includes(collection)) throw new Error('not a cascade collection: ' + collection);
  const record = getById(collection, id);
  if (!record) return Promise.resolve(null);
  const { killedTxns, clearedLinks } = collectDependents(collection, id);
  const killedIds = new Set(killedTxns.map(t => t.id));
  const snapshot = { collection, record, killedTxns, clearedLinks };

  return optimisticWrite(
    () => {
      const next = { ...data };
      next[collection] = data[collection].filter(r => r.id !== id);
      if (killedIds.size) next.transactions = data.transactions.filter(t => !killedIds.has(t.id));
      mapByCollection(next, clearedLinks, x => ({ ...x, accountId: '' }));
      data = next;
    },
    () => del(`/api/${collection}/${id}`), // backend deletes the dependents too
    'Could not delete',
  ).then(() => snapshot);
}

/** Reverse a removeCascade: recreate the record and its transactions and
 * restore the cleared auto-pay links. The backend cascade already removed
 * those rows, so each must be re-posted explicitly. */
export function restoreCascade(snapshot) {
  const { collection, record, killedTxns, clearedLinks } = snapshot;
  return optimisticWrite(
    () => {
      const next = { ...data };
      next[collection] = [...data[collection], record];
      if (killedTxns.length) next.transactions = [...data.transactions, ...killedTxns];
      // Every cleared link pointed at this account, so all restore to record.id.
      mapByCollection(next, clearedLinks, x => ({ ...x, accountId: record.id }));
      data = next;
    },
    () => Promise.all([
      post(`/api/${collection}`, record),
      ...killedTxns.map(t => post('/api/transactions', t)),
      ...clearedLinks.map(({ collection: c, record: r }) => apiPatch(`/api/${c}/${r.id}`, { accountId: r.accountId })),
    ]),
    'Could not restore',
  ).then(() => snapshot);
}

export function getById(collection, id) {
  return data[collection].find(r => r.id === id) || null;
}

export async function resetAll() {
  try {
    data = normalize(await post('/api/data/reset'));
    notify();
  } catch (err) {
    toast(`Could not erase data: ${err.message}`, 'err');
    throw err;
  }
}

export async function loadSample() {
  try {
    data = normalize(await post('/api/data/sample'));
    notify();
  } catch (err) {
    toast(`Could not load sample data: ${err.message}`, 'err');
    throw err;
  }
}

// ---- import / export ----
export function exportJSON() {
  return JSON.stringify(data, null, 2);
}

export async function importJSON(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || !parsed) throw new Error('Not a valid backup file');
  } catch (err) {
    toast(`Could not import: ${err.message}`, 'err');
    throw err;
  }
  try {
    data = normalize(await post('/api/data/import', parsed));
    notify();
  } catch (err) {
    toast(`Could not import: ${err.message}`, 'err');
    throw err;
  }
}

/** Flatten everything into one CSV for spreadsheets. */
export function exportCSV() {
  const rows = [['Type', 'Name', 'Category', 'Amount', 'Frequency/Cycle', 'Detail', 'Notes']];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  data.income.forEach(i => rows.push(['Income', i.source, i.type || '', i.amount, i.frequency, '', i.notes || '']));
  data.expenses.forEach(e => rows.push(['Expense', e.name, e.category, e.amount, e.frequency, '', e.notes || '']));
  data.subscriptions.forEach(s => rows.push(['Subscription', s.name, s.category || '', s.amount, s.cycle, `next: ${s.nextRenewal || ''}`, s.notes || '']));
  data.installments.forEach(it => rows.push(['Installment', it.name, '', it.monthlyPayment, 'monthly', `principal: ${it.principal}, term: ${it.termMonths}mo, apr: ${it.apr || 0}%, start: ${it.startDate || ''}`, it.notes || '']));
  data.savings.forEach(sv => rows.push(['Saving', sv.name, '', sv.target ?? '', '', `saved: ${sv.saved}, monthly: ${sv.monthlyContribution}, deadline: ${sv.deadline || ''}`, sv.notes || '']));
  data.accounts.forEach(a => rows.push(['Account', a.name, a.type, a.balance, '', a.creditLimit ? `limit: ${a.creditLimit}` : '', a.notes || '']));
  data.transactions.forEach(t => rows.push(['Transaction', t.description, t.category || '', t.amount, t.type, t.type === 'transfer' ? `from: ${t.accountId}, to: ${t.toAccountId}` : `account: ${t.accountId}`, t.notes || '']));
  data.budgets.forEach(b => rows.push(['Budget', b.category, b.category, b.monthlyLimit, 'monthly', '', b.notes || '']));
  data.debts.forEach(d => rows.push(['Debt', d.person, d.direction === 'owed_by_me' ? 'You owe' : 'Owed to you', d.amount, '', '', d.notes || '']));
  return rows.map(r => r.map(q).join(',')).join('\n');
}
