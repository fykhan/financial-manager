// forms.js — schema-driven add/edit forms with live calculation previews

import * as store from './store.js';
import { openModal, closeModal, toast } from './ui.js';
import { installmentStatus, goalStatus, toMonthly, FREQ_LABELS, amortizedPayment } from './calc.js';
import { money, todayISO, escapeHtml, titleCase } from './format.js';

const FREQ_OPTIONS = ['weekly', 'biweekly', 'monthly', 'quarterly', 'semiannually', 'annually'];
const SUB_CYCLES = ['weekly', 'monthly', 'quarterly', 'semiannually', 'annually'];

const EXPENSE_CATEGORIES = ['Housing', 'Food', 'Transport', 'Health', 'Bills', 'Education', 'Entertainment', 'Shopping', 'Personal', 'Savings', 'Other'];
const SUB_CATEGORIES = ['Entertainment', 'Software', 'Health', 'News', 'Music', 'Cloud', 'Other'];

const ACCOUNT_TYPES = ['checking', 'savings', 'cash', 'wallet', 'credit'];
const TXN_TYPES = ['expense', 'income', 'transfer'];
const TXN_CATEGORIES = ['Housing', 'Food', 'Transport', 'Health', 'Bills', 'Education', 'Entertainment', 'Shopping', 'Personal', 'Savings', 'Income', 'Transfer', 'Other'];

const accountOptions = () => store.getData().accounts.map(a => ({ value: a.id, label: `${a.name} (${titleCase(a.type)})` }));
const accountOptionsOptional = () => [{ value: '', label: '— none (forecast only) —' }, ...accountOptions()];

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
  goals: {
    title: 'savings goal',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Emergency fund' },
      { name: 'target', label: 'Target amount', type: 'number', required: true, step: '0.01', half: true },
      { name: 'saved', label: 'Saved so far', type: 'number', step: '0.01', def: 0, half: true },
      { name: 'monthlyContribution', label: 'Monthly contribution', type: 'number', step: '0.01', def: 0, half: true },
      { name: 'deadline', label: 'Target date', type: 'date', half: true, hint: 'Optional' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    preview: previewGoal,
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
      { name: 'date', label: 'Date', type: 'date', required: true, def: todayISO(), half: true },
      { name: 'type', label: 'Type', type: 'select', options: TXN_TYPES, def: 'expense', half: true },
      { name: 'description', label: 'Description', type: 'text', required: true, placeholder: 'e.g. Groceries, Salary, Pay off Visa' },
      { name: 'amount', label: 'Amount', type: 'number', required: true, step: '0.01', half: true },
      { name: 'category', label: 'Category', type: 'select', options: TXN_CATEGORIES, def: 'Other', half: true },
      { name: 'accountId', label: 'Account', type: 'select', options: accountOptions, required: true, half: true },
      { name: 'toAccountId', label: 'To account', type: 'select', options: accountOptions, half: true, hint: 'Transfers only', visibleIf: v => v.type === 'transfer' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    validate: v => {
      if (v.type === 'transfer') {
        if (!v.toAccountId) return 'To account is required for transfers';
        if (v.accountId && v.accountId === v.toAccountId) return 'From and to accounts must be different';
      }
      return null;
    },
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

/** Open the add/edit modal for a collection. `id` present => edit. */
export function openForm(collection, id = null) {
  const schema = SCHEMAS[collection];
  const record = id ? store.getById(collection, id) : null;
  const isEdit = !!record;

  const body = `
    <form id="record-form" autocomplete="off">
      ${buildFields(schema.fields, record)}
      ${schema.preview ? `<div id="calc-preview" class="calc-preview"></div>` : ''}
      <div class="modal-actions">
        ${isEdit ? `<button type="button" class="btn btn-danger" data-act="delete">Delete</button>` : ''}
        <span style="flex:1"></span>
        <button type="button" class="btn" data-act="cancel">Cancel</button>
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

  // Live preview for installments / goals.
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

  form.querySelector('[data-act="cancel"]').addEventListener('click', closeModal);
  const delBtn = form.querySelector('[data-act="delete"]');
  if (delBtn) delBtn.addEventListener('click', async () => {
    const { confirmDialog } = await import('./ui.js');
    if (await confirmDialog('Delete?', `Remove “${escapeHtml(record.name || record.source || record.description || 'this item')}”? This can't be undone.`)) {
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

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const values = getValues();
    const err = validate(collection, values);
    if (err) { toast(err, 'err'); return; }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      if (isEdit) { await store.update(collection, id, values); toast('Saved', 'good'); }
      else { await store.add(collection, values); toast(`${titleCase(schema.title)} added`, 'good'); }
      closeModal();
    } catch {
      submitBtn.disabled = false; // store.js already toasted the failure; keep typed input
    }
  });
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

function previewGoal(v) {
  if (!v.target) return `<div class="text-muted">Enter a target to see your timeline.</div>`;
  const st = goalStatus(v);
  const eta = st.monthsToGoal === 0 ? 'Reached 🎉'
    : Number.isFinite(st.monthsToGoal) ? `${st.monthsToGoal} month${st.monthsToGoal === 1 ? '' : 's'}`
    : 'Set a monthly amount';
  return `
    <div class="row"><span>Remaining</span><strong>${money(st.remaining)}</strong></div>
    <div class="row"><span>Progress</span><strong>${Math.round(st.progress * 100)}%</strong></div>
    <div class="row"><span>Time to goal</span><strong>${eta}</strong></div>
    ${st.requiredMonthly != null ? `<div class="row"><span>Needed / month for deadline</span><strong>${money(st.requiredMonthly)}</strong></div>` : ''}`;
}
