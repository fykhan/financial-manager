// forms.js — schema-driven add/edit forms with live calculation previews

import * as store from './store.js';
import { openModal, closeModal, toast } from './ui.js';
import { installmentStatus, goalStatus, toMonthly, FREQ_LABELS, amortizedPayment } from './calc.js';
import { money, todayISO, escapeHtml, titleCase } from './format.js';

const FREQ_OPTIONS = ['weekly', 'biweekly', 'monthly', 'quarterly', 'semiannually', 'annually'];
const SUB_CYCLES = ['weekly', 'monthly', 'quarterly', 'semiannually', 'annually'];

const EXPENSE_CATEGORIES = ['Housing', 'Food', 'Transport', 'Health', 'Bills', 'Education', 'Entertainment', 'Shopping', 'Personal', 'Savings', 'Other'];
const SUB_CATEGORIES = ['Entertainment', 'Software', 'Health', 'News', 'Music', 'Cloud', 'Other'];

// Field schema per collection. Each field: { name, label, type, options?, required?, step?, hint?, half? }
const SCHEMAS = {
  income: {
    title: 'income source',
    fields: [
      { name: 'source', label: 'Source', type: 'text', required: true, placeholder: 'e.g. Salary, Freelance' },
      { name: 'amount', label: 'Amount', type: 'number', required: true, step: '0.01', half: true },
      { name: 'frequency', label: 'How often', type: 'select', options: FREQ_OPTIONS, def: 'monthly', half: true },
      { name: 'type', label: 'Type', type: 'select', options: ['net', 'gross'], def: 'net', hint: 'Net = take-home after tax' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  expenses: {
    title: 'expense',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Rent, Groceries' },
      { name: 'category', label: 'Category', type: 'select', options: EXPENSE_CATEGORIES, def: 'Housing', half: true },
      { name: 'amount', label: 'Amount', type: 'number', required: true, step: '0.01', half: true },
      { name: 'frequency', label: 'How often', type: 'select', options: FREQ_OPTIONS, def: 'monthly' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
  subscriptions: {
    title: 'subscription',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Netflix, Gym' },
      { name: 'amount', label: 'Amount', type: 'number', required: true, step: '0.01', half: true },
      { name: 'cycle', label: 'Billing cycle', type: 'select', options: SUB_CYCLES, def: 'monthly', half: true },
      { name: 'category', label: 'Category', type: 'select', options: SUB_CATEGORIES, def: 'Entertainment', half: true },
      { name: 'nextRenewal', label: 'Next renewal', type: 'date', half: true },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
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
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    preview: previewInstallment,
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
};

export function labelOf(collection) { return SCHEMAS[collection].title; }

function fieldHtml(f, value) {
  const val = value ?? f.def ?? '';
  const req = f.required ? 'required' : '';
  let control;
  if (f.type === 'select') {
    control = `<select class="input" name="${f.name}" ${req}>
      ${f.options.map(o => `<option value="${o}" ${String(val) === o ? 'selected' : ''}>${escapeHtml(FREQ_LABELS[o] || titleCase(o))}</option>`).join('')}
    </select>`;
  } else if (f.type === 'textarea') {
    control = `<textarea class="input" name="${f.name}" placeholder="${f.placeholder || ''}">${escapeHtml(val)}</textarea>`;
  } else {
    const extra = f.type === 'number' ? `step="${f.step || 'any'}" inputmode="decimal"` : '';
    control = `<input class="input" type="${f.type}" name="${f.name}" value="${escapeHtml(val)}"
      placeholder="${f.placeholder || ''}" ${extra} ${req} />`;
  }
  return `<div class="field ${f.half ? 'half' : ''}">
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

  form.querySelector('[data-act="cancel"]').addEventListener('click', closeModal);
  const delBtn = form.querySelector('[data-act="delete"]');
  if (delBtn) delBtn.addEventListener('click', async () => {
    const { confirmDialog } = await import('./ui.js');
    if (await confirmDialog('Delete?', `Remove “${escapeHtml(record.name || record.source)}”? This can't be undone.`)) {
      store.remove(collection, id);
      toast('Deleted', '');
      closeModal();
    }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const values = getValues();
    const err = validate(collection, values);
    if (err) { toast(err, 'err'); return; }
    if (isEdit) { store.update(collection, id, values); toast('Saved', 'good'); }
    else { store.add(collection, values); toast(`${titleCase(schema.title)} added`, 'good'); }
    closeModal();
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
  return null;
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
