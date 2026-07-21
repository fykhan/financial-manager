// forms.js — schema-driven add/edit forms with live calculation previews

import * as store from './store.js';
import { openModal, closeModal, toast } from './ui.js';
import { installmentStatus, savingStatus, toMonthly, FREQ_LABELS, amortizedPayment } from './calc.js';
import { money, todayISO, escapeHtml, titleCase } from './format.js';

const FREQ_OPTIONS = ['weekly', 'biweekly', 'monthly', 'quarterly', 'semiannually', 'annually'];
const SUB_CYCLES = ['weekly', 'monthly', 'quarterly', 'semiannually', 'annually'];

const EXPENSE_CATEGORIES = ['Housing', 'Food', 'Transport', 'Health', 'Bills', 'Education', 'Entertainment', 'Shopping', 'Personal', 'Savings', 'Other'];
const SUB_CATEGORIES = ['Entertainment', 'Software', 'Health', 'News', 'Music', 'Cloud', 'Other'];

const ACCOUNT_TYPES = ['checking', 'savings', 'cash', 'wallet', 'credit'];
const TXN_TYPES = ['expense', 'income', 'transfer', 'debt', 'savings'];
const TXN_CATEGORIES = ['Housing', 'Food', 'Transport', 'Health', 'Bills', 'Education', 'Entertainment', 'Shopping', 'Personal', 'Savings', 'Income', 'Transfer', 'Debt', 'Other'];

const DEBT_DIRECTIONS = [
  { value: 'owed_to_me', label: 'They owe me' },
  { value: 'owed_by_me', label: 'I owe them' },
];
const DEBT_TXN_DIRECTIONS = [
  { value: 'increase', label: "Add to debt (grows what's owed)" },
  { value: 'decrease', label: 'Repayment (reduces what\'s owed)' },
];
const SAVING_TXN_DIRECTIONS = [
  { value: 'contribute', label: 'Contribute (moves money into savings)' },
  { value: 'withdraw', label: 'Withdraw (moves money back out)' },
];

const accountOptions = () => store.getData().accounts.map(a => ({ value: a.id, label: `${a.name} (${titleCase(a.type)})` }));
const accountOptionsOptional = () => [{ value: '', label: '— none (forecast only) —' }, ...accountOptions()];
const debtOptions = () => store.getData().debts.map(d => ({ value: d.id, label: `${d.person} (${d.direction === 'owed_by_me' ? 'you owe' : 'owes you'})` }));
const savingOptions = () => store.getData().savings.map(s => ({ value: s.id, label: s.name }));

// Field schema per collection. Each field: { name, label, type, options?, required?, step?, hint?, half? }
const SCHEMAS = {
  income: {
    title: 'income source',
    fields: [
      { name: 'source', label: 'Source', type: 'text', required: true, placeholder: 'e.g. Salary, Freelance' },
      { name: 'amount', label: 'Amount', type: 'number', required: true, step: '0.01', half: true },
      { name: 'frequency', label: 'How often', type: 'select', options: FREQ_OPTIONS, def: 'monthly', half: true },
      { name: 'type', label: 'Type', type: 'select', options: ['net', 'gross'], def: 'net', hint: 'Net = take-home after tax' },
      { name: 'accountId', label: 'Auto-deposit to account', type: 'select', options: accountOptionsOptional, half: true, hint: 'Optional — posts automatically when due' },
      { name: 'nextDate', label: 'Next payment date', type: 'date', def: todayISO(), half: true, visibleIf: v => !!v.accountId },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    validate: v => {
      if (v.accountId && !v.nextDate) return 'Next payment date is required to auto-deposit this income';
      return null;
    },
  },
  expenses: {
    title: 'expense',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Rent, Groceries' },
      { name: 'category', label: 'Category', type: 'select', options: EXPENSE_CATEGORIES, def: 'Housing', half: true },
      { name: 'amount', label: 'Amount', type: 'number', required: true, step: '0.01', half: true },
      { name: 'frequency', label: 'How often', type: 'select', options: FREQ_OPTIONS, def: 'monthly', half: true },
      { name: 'accountId', label: 'Auto-pay from account', type: 'select', options: accountOptionsOptional, half: true, hint: 'Optional — posts automatically when due' },
      { name: 'nextDate', label: 'Next due date', type: 'date', def: todayISO(), half: true, visibleIf: v => !!v.accountId },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    validate: v => {
      if (v.accountId && !v.nextDate) return 'Next due date is required to auto-pay this expense';
      return null;
    },
  },
  subscriptions: {
    title: 'subscription',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Netflix, Gym' },
      { name: 'amount', label: 'Amount', type: 'number', required: true, step: '0.01', half: true },
      { name: 'cycle', label: 'Billing cycle', type: 'select', options: SUB_CYCLES, def: 'monthly', half: true },
      { name: 'category', label: 'Category', type: 'select', options: SUB_CATEGORIES, def: 'Entertainment', half: true },
      { name: 'nextRenewal', label: 'Next renewal', type: 'date', half: true },
      { name: 'accountId', label: 'Auto-pay from account', type: 'select', options: accountOptionsOptional, half: true, hint: 'Optional — posts automatically at renewal' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    validate: v => {
      if (v.accountId && !v.nextRenewal) return 'Next renewal date is required to auto-pay this subscription';
      return null;
    },
  },
  installments: {
    title: 'installment / loan',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Student loan, Car' },
      { name: 'principal', label: 'Original amount', type: 'number', required: true, step: '0.01', half: true, hint: 'Total borrowed' },
      { name: 'apr', label: 'Interest APR %', type: 'number', step: '0.01', def: 0, half: true, hint: '0 if interest-free' },
      { name: 'termMonths', label: 'Term (months)', type: 'number', required: true, step: '1', half: true },
      { name: 'monthlyPayment', label: 'Monthly payment', type: 'number', step: '0.01', half: true, hint: 'Leave blank to auto-calc' },
      { name: 'startDate', label: 'Start date', type: 'date', def: todayISO(), half: true },
      { name: 'accountId', label: 'Auto-pay from account', type: 'select', options: accountOptionsOptional, half: true, hint: 'Optional — posts automatically when due' },
      { name: 'nextDueDate', label: 'Next payment date', type: 'date', def: todayISO(), half: true, visibleIf: v => !!v.accountId },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    preview: previewInstallment,
    validate: v => {
      if (v.accountId && !v.nextDueDate) return 'Next payment date is required to auto-pay this installment';
      return null;
    },
  },
  savings: {
    title: 'saving',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Emergency fund, or just "Savings"' },
      { name: 'saved', label: 'Starting balance', type: 'number', step: '0.01', def: 0, half: true, hint: 'Before any transfers logged below' },
      { name: 'target', label: 'Savings goal', type: 'number', step: '0.01', half: true, hint: 'Optional — leave blank to just track savings' },
      { name: 'monthlyContribution', label: 'Planned monthly contribution', type: 'number', step: '0.01', def: 0, half: true, hint: 'Optional' },
      { name: 'deadline', label: 'Target date', type: 'date', half: true, hint: 'Optional', visibleIf: v => !!v.target },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    preview: previewSaving,
  },
  accounts: {
    title: 'account',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Checking, GCash, Visa' },
      { name: 'type', label: 'Type', type: 'select', options: ACCOUNT_TYPES, def: 'checking', half: true },
      { name: 'balance', label: 'Current balance', type: 'number', required: true, step: '0.01', def: 0, half: true, hint: 'Credit card? Enter the amount currently owed.' },
      { name: 'creditLimit', label: 'Credit limit', type: 'number', step: '0.01', hint: 'The most this card can carry', visibleIf: v => v.type === 'credit' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  transactions: {
    title: 'transaction',
    fields: [
      // Amount first + autofocus: fastest path is type-the-number then a
      // description. openModal() focuses the first control, so ordering is enough.
      { name: 'amount', label: 'Amount', type: 'number', required: true, step: '0.01', half: true },
      { name: 'description', label: 'Description', type: 'text', required: true, placeholder: 'e.g. Groceries, Salary, Pay off Visa' },
      { name: 'date', label: 'Date', type: 'date', required: true, def: todayISO(), half: true },
      { name: 'type', label: 'Type', type: 'select', options: TXN_TYPES, def: 'expense', half: true },
      { name: 'category', label: 'Category', type: 'select', options: TXN_CATEGORIES, def: 'Other', half: true },
      { name: 'accountId', label: 'Account', type: 'select', options: accountOptions, half: true, visibleIf: v => v.type !== 'debt' },
      { name: 'toAccountId', label: 'To account', type: 'select', options: accountOptions, half: true, hint: 'Transfers only', visibleIf: v => v.type === 'transfer' },
      { name: 'debtId', label: 'Person', type: 'select', options: debtOptions, half: true, visibleIf: v => v.type === 'debt' },
      { name: 'debtDirection', label: 'Effect', type: 'select', options: DEBT_TXN_DIRECTIONS, def: 'increase', half: true, visibleIf: v => v.type === 'debt' },
      { name: 'savingId', label: 'Savings', type: 'select', options: savingOptions, half: true, visibleIf: v => v.type === 'savings' },
      { name: 'savingDirection', label: 'Effect', type: 'select', options: SAVING_TXN_DIRECTIONS, def: 'contribute', half: true, visibleIf: v => v.type === 'savings' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    validate: v => {
      if (v.type === 'transfer') {
        if (!v.toAccountId) return 'To account is required for transfers';
        if (v.accountId && v.accountId === v.toAccountId) return 'From and to accounts must be different';
      } else if (v.type === 'debt') {
        if (!v.debtId) return 'Select which debt this affects';
        if (!v.debtDirection) return 'Select whether this adds to or reduces the debt';
      } else if (v.type === 'savings') {
        if (!v.savingId) return 'Select which savings entry this affects';
        if (!v.savingDirection) return 'Select whether this is a contribution or a withdrawal';
        if (!v.accountId) return 'Account is required';
      } else if (!v.accountId) {
        return 'Account is required';
      }
      return null;
    },
  },
  budgets: {
    title: 'budget',
    fields: [
      { name: 'category', label: 'Category', type: 'select', options: EXPENSE_CATEGORIES, def: 'Housing' },
      { name: 'monthlyLimit', label: 'Monthly limit', type: 'number', required: true, step: '0.01' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  debts: {
    title: 'debt',
    fields: [
      { name: 'person', label: 'Person', type: 'text', required: true, placeholder: 'e.g. John, Sarah' },
      { name: 'direction', label: 'Direction', type: 'select', options: DEBT_DIRECTIONS, def: 'owed_to_me', half: true },
      { name: 'amount', label: 'Amount', type: 'number', required: true, step: '0.01', half: true, hint: 'How much is currently outstanding' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
};

export function labelOf(collection) { return SCHEMAS[collection].title; }

function resolveOptions(f) {
  const opts = typeof f.options === 'function' ? f.options() : f.options;
  return opts.map(o => (typeof o === 'object' ? o : { value: o, label: FREQ_LABELS[o] || titleCase(o) }));
}

function fieldHtml(f, value) {
  const val = value ?? f.def ?? '';
  const req = f.required ? 'required' : '';
  let control;
  if (f.type === 'select') {
    const opts = resolveOptions(f);
    control = `<select class="input" name="${f.name}" ${req}>
      ${opts.map(o => `<option value="${escapeHtml(o.value)}" ${String(val) === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>`;
  } else if (f.type === 'textarea') {
    control = `<textarea class="input" name="${f.name}" placeholder="${f.placeholder || ''}">${escapeHtml(val)}</textarea>`;
  } else {
    const extra = f.type === 'number' ? `step="${f.step || 'any'}" inputmode="decimal"` : '';
    control = `<input class="input" type="${f.type}" name="${f.name}" value="${escapeHtml(val)}"
      placeholder="${f.placeholder || ''}" ${extra} ${req} />`;
  }
  return `<div class="field ${f.half ? 'half' : ''}" data-field-wrap="${f.name}">
    <label>${f.label}${f.required ? ' *' : ''}</label>
    ${control}
    ${f.hint ? `<div class="field-hint">${f.hint}</div>` : ''}
  </div>`;
}

/** Group half-width fields into rows. */
function buildFields(fields, record) {
  let html = '', i = 0;
  while (i < fields.length) {
    const f = fields[i];
    if (f.half && fields[i + 1] && fields[i + 1].half) {
      html += `<div class="field-row">${fieldHtml(f, record?.[f.name])}${fieldHtml(fields[i + 1], record?.[fields[i + 1].name])}</div>`;
      i += 2;
    } else {
      html += fieldHtml(f, record?.[f.name]);
      i += 1;
    }
  }
  return html;
}

const LAST_TXN_KEY = 'gradplan.lastTxn';

/** Remembered account/type from the last logged transaction — sticky defaults
 * for the next add (never applied when editing). */
function stickyTxnDefaults() {
  try { return JSON.parse(localStorage.getItem(LAST_TXN_KEY)) || {}; }
  catch { return {}; }
}
function saveStickyTxn(values) {
  try { localStorage.setItem(LAST_TXN_KEY, JSON.stringify({ accountId: values.accountId || '', type: values.type || 'expense' })); }
  catch { /* private mode / quota — non-fatal */ }
}

/** The five categories used most in logged transactions this quarter, most-used
 * first. Data-derived UI (not financial math), so it lives here, not in calc.js. */
function topCategoriesThisQuarter(transactions) {
  const now = new Date();
  const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const startISO = `${qStart.getFullYear()}-${String(qStart.getMonth() + 1).padStart(2, '0')}-01`;
  const counts = new Map();
  (transactions || []).forEach(t => {
    if (!t.category || (t.date && t.date < startISO)) return;
    counts.set(t.category, (counts.get(t.category) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);
}

/** Unique descriptions from the most recent transactions, for datalist + prefill. */
function recentDescriptions(transactions, n = 50) {
  const seen = new Set();
  const out = [];
  [...(transactions || [])]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .forEach(t => {
      const d = (t.description || '').trim();
      if (d && !seen.has(d.toLowerCase())) { seen.add(d.toLowerCase()); out.push({ description: d, txn: t }); }
    });
  return out.slice(0, n);
}

/** Open the add/edit modal for a collection. `id` present => edit.
 * Options: { prefill } seeds an add form; { onSaved } fires with the saved
 * record after a successful create/update (used by "Mark paid" to advance a source date). */
export function openForm(collection, id = null, { prefill = null, onSaved = null } = {}) {
  const schema = SCHEMAS[collection];
  const record = id ? store.getById(collection, id) : null;
  const isEdit = !!record;

  // Sticky defaults (transactions, add only) fold into prefill; explicit
  // prefill wins over remembered values.
  let seed = record;
  if (!isEdit) {
    const sticky = collection === 'transactions' ? stickyTxnDefaults() : {};
    const merged = { ...sticky, ...(prefill || {}) };
    seed = Object.keys(merged).length ? merged : null;
  }

  const isTxn = collection === 'transactions';
  const body = `
    <form id="record-form" autocomplete="off">
      ${buildFields(schema.fields, seed)}
      ${schema.preview ? `<div id="calc-preview" class="calc-preview"></div>` : ''}
      ${isTxn ? `<datalist id="txn-desc-list"></datalist>` : ''}
      <div class="modal-actions">
        ${isEdit ? `<button type="button" class="btn btn-danger" data-act="delete">Delete</button>` : ''}
        <span style="flex:1"></span>
        <button type="button" class="btn" data-act="cancel">Cancel</button>
        ${isTxn && !isEdit ? `<button type="button" class="btn" data-act="save-add">Save &amp; add another</button>` : ''}
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save changes' : 'Add'}</button>
      </div>
    </form>`;

  openModal(`${isEdit ? 'Edit' : 'Add'} ${schema.title}`, body);

  const form = document.getElementById('record-form');
  const getValues = () => {
    const fd = new FormData(form);
    const obj = {};
    schema.fields.forEach(f => {
      let v = fd.get(f.name);
      if (f.type === 'number') v = v === '' || v == null ? '' : Number(v);
      obj[f.name] = v ?? '';
    });
    return obj;
  };

  // Live preview for installments / savings.
  const previewEl = document.getElementById('calc-preview');
  const refresh = () => { if (schema.preview && previewEl) previewEl.innerHTML = schema.preview(getValues()); };
  if (schema.preview) { refresh(); form.addEventListener('input', refresh); }

  // Conditionally-visible fields (e.g. "to account" only for transfers).
  const applyVisibility = () => {
    const values = getValues();
    schema.fields.forEach(f => {
      if (!f.visibleIf) return;
      const wrap = form.querySelector(`[data-field-wrap="${f.name}"]`);
      if (!wrap) return;
      const show = f.visibleIf(values);
      wrap.hidden = !show;
      wrap.querySelectorAll('input,select,textarea').forEach(inp => { inp.disabled = !show; });
    });
  };
  if (schema.fields.some(f => f.visibleIf)) { applyVisibility(); form.addEventListener('input', applyVisibility); }

  // ---- fast-entry extras (transactions only) ----
  if (isTxn) setupTxnFastEntry(form, getValues);

  form.querySelector('[data-act="cancel"]').addEventListener('click', closeModal);
  const delBtn = form.querySelector('[data-act="delete"]');
  if (delBtn) delBtn.addEventListener('click', async () => {
    const { confirmDialog } = await import('./ui.js');
    if (await confirmDialog('Delete?', `Remove “${escapeHtml(record.name || record.source || record.description || record.category || record.person || 'this item')}”? This can't be undone.`)) {
      delBtn.disabled = true;
      try {
        await store.remove(collection, id);
        toast('Deleted', '');
        closeModal();
      } catch {
        delBtn.disabled = false; // store.js already toasted the failure
      }
    }
  });

  // "Save & add another" reuses the normal submit path, flagged so success
  // re-opens a fresh form instead of closing.
  let saveAndAdd = false;
  const saveAddBtn = form.querySelector('[data-act="save-add"]');
  if (saveAddBtn) saveAddBtn.addEventListener('click', () => { saveAndAdd = true; form.requestSubmit(); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const values = getValues();
    const err = validate(collection, values);
    if (err) { toast(err, 'err'); saveAndAdd = false; return; }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    if (saveAddBtn) saveAddBtn.disabled = true;
    try {
      let saved;
      if (isEdit) { saved = await store.update(collection, id, values); toast('Saved', 'good'); }
      else { saved = await store.add(collection, values); toast(`${titleCase(schema.title)} added`, 'good'); }
      if (isTxn && !isEdit) saveStickyTxn(values);
      if (onSaved) { try { await onSaved(saved); } catch { /* non-fatal follow-up */ } }
      if (saveAndAdd && !isEdit) {
        // Keep date + account + type; clear the rest for the next entry.
        openForm(collection, null, { prefill: { date: values.date, accountId: values.accountId, type: values.type }, onSaved });
      } else {
        closeModal();
      }
    } catch {
      submitBtn.disabled = false; // store.js already toasted the failure; keep typed input
      if (saveAddBtn) saveAddBtn.disabled = false;
      saveAndAdd = false;
    }
  });
}

/** Wire the transaction form's category chips, date shortcuts, and
 * description autocomplete. All are progressive: they only enhance an
 * already-working form. */
function setupTxnFastEntry(form, getValues) {
  const transactions = store.getData().transactions || [];

  // --- Category chips: most-used categories this quarter, tap to select ---
  const catWrap = form.querySelector('[data-field-wrap="category"]');
  const catSelect = form.querySelector('select[name="category"]');
  const topCats = topCategoriesThisQuarter(transactions);
  if (catWrap && catSelect && topCats.length) {
    const chips = document.createElement('div');
    chips.className = 'chip-row';
    chips.innerHTML = topCats.map(c => `<button type="button" class="chip" data-chip="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
    catWrap.appendChild(chips);
    chips.addEventListener('click', e => {
      const chip = e.target.closest('[data-chip]');
      if (!chip) return;
      // Add the category as an option if the select doesn't already have it.
      const val = chip.dataset.chip;
      if (![...catSelect.options].some(o => o.value === val)) catSelect.add(new Option(val, val));
      catSelect.value = val;
      catSelect.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  // --- Date shortcuts: Today / Yesterday ---
  const dateWrap = form.querySelector('[data-field-wrap="date"]');
  const dateInput = form.querySelector('input[name="date"]');
  if (dateWrap && dateInput) {
    const shortcuts = document.createElement('div');
    shortcuts.className = 'date-shortcuts';
    shortcuts.innerHTML = `
      <button type="button" class="chip" data-date-set="0">Today</button>
      <button type="button" class="chip" data-date-set="-1">Yesterday</button>`;
    dateWrap.appendChild(shortcuts);
    shortcuts.addEventListener('click', e => {
      const btn = e.target.closest('[data-date-set]');
      if (!btn) return;
      const d = new Date();
      d.setDate(d.getDate() + Number(btn.dataset.dateSet));
      dateInput.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      dateInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  // --- Description autocomplete: datalist of recent descriptions; picking one
  //     prefills amount/category/account from the most recent matching txn ---
  const descInput = form.querySelector('input[name="description"]');
  const datalist = form.querySelector('#txn-desc-list');
  if (descInput && datalist) {
    const history = recentDescriptions(transactions);
    datalist.innerHTML = history.map(h => `<option value="${escapeHtml(h.description)}"></option>`).join('');
    descInput.setAttribute('list', 'txn-desc-list');
    const byDesc = new Map(history.map(h => [h.description.toLowerCase(), h.txn]));
    descInput.addEventListener('input', () => {
      const match = byDesc.get(descInput.value.trim().toLowerCase());
      if (!match) return;
      const amt = form.querySelector('input[name="amount"]');
      const cat = form.querySelector('select[name="category"]');
      const acc = form.querySelector('select[name="accountId"]');
      if (amt && !amt.value) amt.value = match.amount ?? '';
      if (cat && match.category && [...cat.options].some(o => o.value === match.category)) cat.value = match.category;
      if (acc && match.accountId && [...acc.options].some(o => o.value === match.accountId)) acc.value = match.accountId;
      form.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

function validate(collection, v) {
  const schema = SCHEMAS[collection];
  for (const f of schema.fields) {
    if (f.required && (v[f.name] === '' || v[f.name] == null)) return `${f.label} is required`;
  }
  const amountFields = ['amount', 'principal', 'target', 'termMonths'];
  for (const key of amountFields) {
    if (key in v && v[key] !== '' && Number(v[key]) < 0) return `${key} can't be negative`;
  }
  return schema.validate ? schema.validate(v) : null;
}

// ---- live preview renderers ----
function previewInstallment(v) {
  if (!v.principal || !v.termMonths) return `<div class="text-muted">Enter amount and term to see the payoff plan.</div>`;
  const it = { ...v, monthlyPayment: v.monthlyPayment || 0 };
  const st = installmentStatus(it);
  const autoPay = !v.monthlyPayment;
  const suggested = v.apr > 0 ? amortizedPayment(v.principal, v.apr, v.termMonths) : (v.principal / v.termMonths);
  return `
    <div class="row"><span>Monthly payment${autoPay ? ' (auto)' : ''}</span><strong>${money(autoPay ? suggested : st.monthlyPayment)}</strong></div>
    <div class="row"><span>Total of payments</span><strong>${money((autoPay ? suggested : st.monthlyPayment) * v.termMonths)}</strong></div>
    <div class="row"><span>Total interest</span><strong>${money(Math.max(0, (autoPay ? suggested : st.monthlyPayment) * v.termMonths - Number(v.principal)))}</strong></div>
    <div class="row"><span>Paid off after</span><strong>${st.monthsPaid} / ${v.termMonths} months</strong></div>
    <div class="row"><span>Remaining balance</span><strong>${money(st.remainingBalance)}</strong></div>`;
}

function previewSaving(v) {
  if (!v.target) return `<div class="text-muted">No savings goal set — this will just track a running balance as you contribute.</div>`;
  const st = savingStatus(v);
  const eta = st.monthsToGoal === 0 ? 'Reached 🎉'
    : Number.isFinite(st.monthsToGoal) ? `${st.monthsToGoal} month${st.monthsToGoal === 1 ? '' : 's'}`
    : 'Set a monthly amount';
  return `
    <div class="row"><span>Remaining</span><strong>${money(st.remaining)}</strong></div>
    <div class="row"><span>Progress</span><strong>${Math.round(st.progress * 100)}%</strong></div>
    <div class="row"><span>Time to goal</span><strong>${eta}</strong></div>
    ${st.requiredMonthly != null ? `<div class="row"><span>Needed / month for deadline</span><strong>${money(st.requiredMonthly)}</strong></div>` : ''}`;
}
