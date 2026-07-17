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
  goals: [],
  accounts: [],
  transactions: [],
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
    goals: parsed.goals || [],
    accounts: parsed.accounts || [],
    transactions: parsed.transactions || [],
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

const COLLECTIONS = ['income', 'expenses', 'installments', 'subscriptions', 'goals', 'accounts', 'transactions'];

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
  data.goals.forEach(g => rows.push(['Goal', g.name, '', g.target, '', `saved: ${g.saved}, monthly: ${g.monthlyContribution}, deadline: ${g.deadline || ''}`, g.notes || '']));
  data.accounts.forEach(a => rows.push(['Account', a.name, a.type, a.balance, '', a.creditLimit ? `limit: ${a.creditLimit}` : '', a.notes || '']));
  data.transactions.forEach(t => rows.push(['Transaction', t.description, t.category || '', t.amount, t.type, t.type === 'transfer' ? `from: ${t.accountId}, to: ${t.toAccountId}` : `account: ${t.accountId}`, t.notes || '']));
  return rows.map(r => r.map(q).join(',')).join('\n');
}
