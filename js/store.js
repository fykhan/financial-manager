// store.js — data model, persistence (localStorage), import/export, sample data

const KEY = 'gradplan.v1';

const emptyData = () => ({
  version: 1,
  settings: { currency: 'USD', name: '' },
  income: [],
  expenses: [],
  installments: [],
  subscriptions: [],
  goals: [],
});

const listeners = new Set();
let data = load();

function uid() {
  return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return withSample(emptyData());
    const parsed = JSON.parse(raw);
    return normalize(parsed);
  } catch {
    return withSample(emptyData());
  }
}

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
  };
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* quota / private mode */ }
  listeners.forEach(fn => fn(data));
}

// ---- public API ----
export function getData() { return data; }
export function getSettings() { return data.settings; }

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function updateSettings(patch) {
  data.settings = { ...data.settings, ...patch };
  persist();
}

const COLLECTIONS = ['income', 'expenses', 'installments', 'subscriptions', 'goals'];

export function add(collection, record) {
  if (!COLLECTIONS.includes(collection)) throw new Error('bad collection ' + collection);
  const rec = { ...record, id: uid(), createdAt: new Date().toISOString() };
  data[collection].push(rec);
  persist();
  return rec;
}

export function update(collection, id, patch) {
  const list = data[collection];
  const idx = list.findIndex(r => r.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, id };
  persist();
  return list[idx];
}

export function remove(collection, id) {
  data[collection] = data[collection].filter(r => r.id !== id);
  persist();
}

export function getById(collection, id) {
  return data[collection].find(r => r.id === id) || null;
}

export function resetAll() {
  data = emptyData();
  persist();
}

export function loadSample() {
  data = withSample(emptyData());
  persist();
}

// ---- import / export ----
export function exportJSON() {
  return JSON.stringify(data, null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || !parsed) throw new Error('Not a valid backup file');
  data = normalize(parsed);
  persist();
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
  return rows.map(r => r.map(q).join(',')).join('\n');
}

// ---- sample data for first run ----
function withSample(d) {
  const today = new Date();
  const iso = (y, m, day) => new Date(y, m, day).toISOString().slice(0, 10);
  const thisYear = today.getFullYear();
  const soon = new Date(today.getTime() + 12 * 86400000).toISOString().slice(0, 10);
  const laterRenewal = new Date(today.getTime() + 25 * 86400000).toISOString().slice(0, 10);

  d.settings.name = '';
  d.income = [
    { id: uid(), source: 'Junior Developer salary', amount: 3800, frequency: 'monthly', type: 'net', notes: 'Take-home after tax' },
    { id: uid(), source: 'Freelance / side projects', amount: 450, frequency: 'monthly', type: 'net', notes: '' },
  ];
  d.expenses = [
    { id: uid(), name: 'Rent', category: 'Housing', amount: 1200, frequency: 'monthly', notes: 'Shared apartment' },
    { id: uid(), name: 'Groceries', category: 'Food', amount: 320, frequency: 'monthly', notes: '' },
    { id: uid(), name: 'Utilities', category: 'Housing', amount: 110, frequency: 'monthly', notes: 'Electric + water + internet' },
    { id: uid(), name: 'Transit pass', category: 'Transport', amount: 75, frequency: 'monthly', notes: '' },
    { id: uid(), name: 'Health insurance', category: 'Health', amount: 180, frequency: 'monthly', notes: '' },
    { id: uid(), name: 'Phone plan', category: 'Bills', amount: 40, frequency: 'monthly', notes: '' },
  ];
  d.installments = [
    { id: uid(), name: 'Student loan', principal: 24000, monthlyPayment: 280, termMonths: 120, startDate: iso(thisYear, 0, 1), apr: 4.5, notes: 'Federal loan' },
    { id: uid(), name: 'Laptop (financed)', principal: 1600, monthlyPayment: 145, termMonths: 12, startDate: iso(thisYear, today.getMonth() - 3, 5), apr: 0, notes: '0% promo' },
  ];
  d.subscriptions = [
    { id: uid(), name: 'Spotify', amount: 11, cycle: 'monthly', category: 'Entertainment', nextRenewal: soon, notes: '' },
    { id: uid(), name: 'Gym membership', amount: 35, cycle: 'monthly', category: 'Health', nextRenewal: laterRenewal, notes: '' },
    { id: uid(), name: 'Cloud storage', amount: 100, cycle: 'annually', category: 'Software', nextRenewal: iso(thisYear + 1, 2, 10), notes: '2TB plan' },
  ];
  d.goals = [
    { id: uid(), name: 'Emergency fund', target: 10000, saved: 2400, monthlyContribution: 400, deadline: iso(thisYear + 1, 11, 31), notes: '3–6 months of expenses' },
    { id: uid(), name: 'Travel fund', target: 3000, saved: 600, monthlyContribution: 150, deadline: '', notes: '' },
  ];
  return d;
}
