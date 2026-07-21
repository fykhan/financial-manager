// views.js — renders each screen as an HTML string

import {
  summary, spendingByCategory, installmentStatus, savingStatus, savingBalance,
  toMonthly, FREQ_LABELS, assessSavingsRate, assessDTI, daysUntil,
  accountBalance, accountsSummary, paymentsDueThisMonth, incomeDueThisMonth,
  budgetStatus, netWorthHistory, currentNetWorth, debtBalance, debtsSummary, dueSoon,
  isScheduled, scheduledTransactions, statement,
} from './calc.js';
import { donut, compareBars, progressBar, seriesColor, lineChart } from './charts.js';
import { money, moneyCompact, pct, num, dateLabel, monthLabel, escapeHtml, titleCase, getCurrency, todayISO } from './format.js';

const VIEW_TITLES = {
  dashboard: 'Dashboard', transactions: 'Transactions', income: 'Income', expenses: 'Expenses',
  installments: 'Installments', subscriptions: 'Subscriptions', savings: 'Savings',
  accounts: 'Accounts', debts: 'Debts', statement: 'Statement',
};
export function viewTitle(v) { return VIEW_TITLES[v] || 'GradPlan'; }

function empty(ico, title, msg, collection) {
  return `<div class="empty">
    <div class="empty-ico">${ico}</div>
    <h3>${title}</h3><p>${msg}</p>
    <button class="btn btn-primary" data-add="${collection}">+ Add ${collection === 'income' ? 'income' : collection.replace(/s$/, '')}</button>
  </div>`;
}

/** Small "auto-pay" indicator for records linked to an account. */
function autoBadge(accountId, data) {
  if (!accountId) return '';
  const acc = (data.accounts || []).find(a => a.id === accountId);
  return `<span class="badge good" title="Auto-pay: ${escapeHtml(acc?.name || 'linked account')}">⚡ ${escapeHtml(acc?.name || 'Auto')}</span>`;
}

/** A future-dated transaction hasn't posted yet — flag it in any ledger row. */
function scheduledBadge(t) {
  if (!isScheduled(t)) return '';
  return `<span class="badge warn" title="Dated in the future — not yet counted in any balance">Scheduled</span>`;
}

function rowActions(collection, id) {
  return `<div class="row-actions">
    <button class="btn btn-ghost btn-icon btn-sm" data-edit="${collection}" data-id="${id}" title="Edit">✎</button>
    <button class="btn btn-ghost btn-icon btn-sm btn-danger" data-del="${collection}" data-id="${id}" title="Delete">🗑</button>
  </div>`;
}

function statTile({ label, value, sub, subClass = '', dot }) {
  return `<div class="stat">
    <div class="stat-label">${dot ? `<span class="dot" style="background:${dot}"></span>` : ''}${label}</div>
    <div class="stat-value tabular">${value}</div>
    ${sub ? `<div class="stat-sub ${subClass}">${sub}</div>` : ''}
  </div>`;
}

// ---------------- Spending-by-category chart (shared: dashboard + expenses) ----------------
const SPEND_MODES = {
  auto: { label: 'Total', sub: "This month's spending by category" },
  fixed: { label: 'Fixed', sub: 'Fixed monthly costs by category' },
  transactions: { label: 'Actual', sub: "Logged transactions this month, by category" },
};
let spendMode = 'auto';
export function setSpendMode(mode) { if (SPEND_MODES[mode]) spendMode = mode; }

function spendModeToggle() {
  return `<div class="flex gap-8" role="group" aria-label="Spending source">
    ${Object.entries(SPEND_MODES).map(([key, { label }]) => `
      <button type="button" class="btn btn-sm ${spendMode === key ? 'btn-primary' : 'btn-ghost'}" data-spend-mode="${key}" aria-pressed="${spendMode === key}">${label}</button>
    `).join('')}
  </div>`;
}

/** Reusable "spending by category" panel: donut + fixed/actual/total toggle. */
function spendingByCategoryPanel(data, { title = 'Where your money goes' } = {}) {
  const cats = spendingByCategory(data, undefined, spendMode);
  return `<div class="panel">
    <div class="flex between center" style="flex-wrap:wrap;gap:10px">
      <h3 style="margin:0">${title}</h3>
      ${spendModeToggle()}
    </div>
    <div class="panel-sub">${SPEND_MODES[spendMode].sub}</div>
    ${donut(cats, { centerLabel: 'per month' })}
  </div>`;
}

// ---------------- Dashboard ----------------
export function renderDashboard(data) {
  const s = summary(data);
  const sr = assessSavingsRate(s.savingsRate);
  const dti = assessDTI(s.dti);
  const statusColor = { good: 'var(--good)', warning: 'var(--warning)', serious: 'var(--serious)', critical: 'var(--critical)' };

  if (s.counts.income === 0 && s.counts.expenses === 0 && s.counts.installments === 0 && s.counts.subscriptions === 0) {
    return `<div class="card">${empty('◧', 'Welcome to GradPlan', 'Add your income and expenses to see your full financial picture, or load sample data from ⚙ Data.', 'income')}</div>`;
  }

  const net = s.netCashFlow;

  const tiles = `<div class="stat-grid">
    ${statTile({ label: 'Monthly income', value: money(s.monthlyIncome), sub: `${money(s.annualIncome, { cents: false })} / year` })}
    ${statTile({ label: 'Monthly expenses', value: money(s.monthlyExpenses), sub: `incl. ${money(s.monthlyDebt)} debt` })}
    ${statTile({ label: 'Net cash flow', value: money(net), sub: net >= 0 ? 'Surplus each month' : 'Shortfall each month', subClass: net >= 0 ? 'pos' : 'neg' })}
    ${statTile({ label: 'Savings rate', value: pct(s.savingsRate, 0), sub: sr.label, dot: statusColor[sr.level] })}
  </div>`;

  const panels = `<div class="dash-grid">
    ${spendingByCategoryPanel(data)}
    <div class="panel">
      <h3>Income vs. expenses</h3>
      <div class="panel-sub">Monthly comparison</div>
      ${compareBars([
        { label: 'Income', value: s.monthlyIncome, color: seriesColor(1) },
        { label: 'Expenses', value: s.monthlyExpenses, color: seriesColor(5) },
      ])}
      <div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--border)">
        ${miniRow('Savings contributions', money(s.monthlySavingsContrib))}
        <div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border)">
          ${miniRow('<strong>Left after savings</strong>', `<strong class="${s.leftoverAfterSavings >= 0 ? 'text-good' : 'text-crit'}">${money(s.leftoverAfterSavings)}</strong>`)}
        </div>
      </div>
    </div>
    ${budgetsOverviewPanel(data)}
  </div>`;

  const health = `<div class="section" style="margin-top:24px">
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
      ${statTile({ label: 'Debt-to-income', value: pct(s.dti, 0), sub: dti.label, dot: statusColor[dti.level] })}
      ${statTile({ label: 'Total debt remaining', value: moneyCompact(s.totalDebtRemaining), sub: `${s.counts.activeInstallments} active installment${s.counts.activeInstallments === 1 ? '' : 's'}` })}
      ${statTile({ label: 'Active savings', value: num(s.counts.savings), sub: `${money(s.monthlySavingsContrib)}/mo set aside` })}
    </div>
  </div>`;

  const accountsRow = accountsOverviewRow(data);
  const activity = dashboardActivityRow(data);

  return `${tiles}${panels}${health}${accountsRow}${activity}`;
}

/**
 * Compact "top N budgets closest to (or over) their limit" panel for the
 * dashboard. Full detail (every budget, add/edit/delete) lives on the
 * Expenses page's own budgets panel — this is a preview, not a replacement.
 */
function budgetsOverviewPanel(data) {
  const statuses = budgetStatus(data);
  if (!statuses.length) return '';
  const statusColor = { good: 'var(--good)', warning: 'var(--warning)', serious: 'var(--serious)', critical: 'var(--critical)' };
  const top = [...statuses].sort((a, b) => b.pctUsed - a.pctUsed).slice(0, 4);
  return `<div class="panel">
    <div class="flex between center">
      <h3 style="margin:0">Budgets this month</h3>
      <a href="#expenses" class="text-muted" style="font-size:12.5px">View all →</a>
    </div>
    <div class="panel-sub">Spent vs. monthly limit</div>
    <div style="display:flex;flex-direction:column;gap:14px">
      ${top.map(s => `<div>
        <div class="flex between" style="font-size:13px;margin-bottom:5px">
          <span class="flex center gap-8">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColor[s.level]}"></span>
            ${escapeHtml(s.category)}
          </span>
          <span class="text-muted">${money(s.actual)} / ${money(s.limit)}</span>
        </div>
        ${progressBar(Math.min(1, s.pctUsed), { good: s.level === 'good' })}
      </div>`).join('')}
    </div>
  </div>`;
}

function accountsOverviewRow(data) {
  if (!(data.accounts || []).length) return '';
  const acc = accountsSummary(data);
  const due = paymentsDueThisMonth(data);
  const incoming = incomeDueThisMonth(data);
  return `<div class="section" style="margin-top:24px">
    <div class="stat-grid">
      ${statTile({ label: 'Total cash', value: money(acc.totalCash) })}
      ${statTile({ label: 'Total credit due', value: money(acc.totalCreditOwed) })}
      ${statTile({ label: 'Balance', value: money(acc.balance), sub: 'Cash minus credit — spendable now' })}
      ${statTile({ label: 'Net worth', value: money(currentNetWorth(data)), sub: 'Balance plus savings' })}
      ${statTile({ label: 'Incoming this month', value: money(incoming.total), sub: `${incoming.items.length} payment${incoming.items.length === 1 ? '' : 's'}` })}
      ${statTile({ label: 'Due this month', value: money(due.total), sub: `${due.items.length} payment${due.items.length === 1 ? '' : 's'}` })}
    </div>
  </div>`;
}

function miniRow(label, value) {
  return `<div class="flex between" style="padding:5px 0;font-size:13.5px"><span class="text-muted">${label}</span><span style="font-variant-numeric:tabular-nums">${value}</span></div>`;
}

/** Second dashboard row: recent activity, what's due soon, and what's scheduled. */
function dashboardActivityRow(data) {
  const panelsHtml = [recentTransactionsPanel(data), dueSoonPanel(data), scheduledPanel(data)].filter(Boolean).join('');
  if (!panelsHtml) return '';
  return `<div class="dash-grid" style="margin-top:8px">${panelsHtml}</div>`;
}

function recentTransactionsPanel(data) {
  const transactions = data.transactions || [];
  const recent = [...transactions]
    .filter(t => !isScheduled(t))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 5);
  if (!recent.length) return '';
  return `<div class="panel">
    <div class="flex between center">
      <h3 style="margin:0">Recent transactions</h3>
      <a href="#accounts" class="text-muted" style="font-size:12.5px">View all →</a>
    </div>
    <div class="panel-sub">Latest activity across every account</div>
    <div class="table-wrap"><table class="data"><tbody>
      ${recent.map(t => `<tr>
        <td class="cell-muted" data-label="Date">${dateLabel(t.date)}</td>
        <td class="cell-strong" data-label="Description">${escapeHtml(t.description)}</td>
        <td data-label="Category"><span class="badge cat">${escapeHtml(t.category || 'Other')}</span></td>
        <td class="num ${t.type === 'income' || (t.type === 'savings' && t.savingDirection === 'withdraw') ? 'text-good' : t.type === 'expense' || (t.type === 'savings' && t.savingDirection === 'contribute') ? 'text-crit' : ''}" data-label="Amount">${t.type === 'expense' || (t.type === 'savings' && t.savingDirection === 'contribute') ? '−' : t.type === 'income' || (t.type === 'savings' && t.savingDirection === 'withdraw') ? '+' : ''}${money(t.amount)}</td>
      </tr>`).join('')}
    </tbody></table></div>
  </div>`;
}

/** Manually-entered transactions dated in the future — not yet counted in any balance. */
function scheduledPanel(data) {
  const upcoming = scheduledTransactions(data).slice(0, 5);
  if (!upcoming.length) return '';
  return `<div class="panel">
    <div class="flex between center">
      <h3 style="margin:0">Scheduled</h3>
      <a href="#accounts" class="text-muted" style="font-size:12.5px">View all →</a>
    </div>
    <div class="panel-sub">Future-dated transactions — excluded from balances until their date arrives</div>
    <div class="table-wrap"><table class="data"><tbody>
      ${upcoming.map(t => `<tr>
        <td class="cell-muted" data-label="Date">${dateLabel(t.date)}</td>
        <td class="cell-strong" data-label="Description">${escapeHtml(t.description)}</td>
        <td data-label="Category"><span class="badge cat">${escapeHtml(t.category || 'Other')}</span></td>
        <td class="num ${t.type === 'income' || (t.type === 'savings' && t.savingDirection === 'withdraw') ? 'text-good' : t.type === 'expense' || (t.type === 'savings' && t.savingDirection === 'contribute') ? 'text-crit' : ''}" data-label="Amount">${t.type === 'expense' || (t.type === 'savings' && t.savingDirection === 'contribute') ? '−' : t.type === 'income' || (t.type === 'savings' && t.savingDirection === 'withdraw') ? '+' : ''}${money(t.amount)}</td>
      </tr>`).join('')}
    </tbody></table></div>
  </div>`;
}

const DUE_SOON_ICON = { subscription: '⟳', expense: '↘', installment: '◈' };

/** Unified "what's coming up" list — subscriptions, auto-pay expenses, and auto-pay installments, merged and date-sorted (see calc.js's dueSoon). */
function dueSoonPanel(data) {
  const items = dueSoon(data);
  if (!items.length) return '';
  return `<div class="panel">
    <h3>Due soon</h3>
    <div class="panel-sub">Subscriptions, bills and installments in the next 14 days</div>
    <div class="table-wrap"><table class="data"><tbody>
      ${items.map(i => `<tr>
        <td class="cell-strong" data-label="Item">${DUE_SOON_ICON[i.kind] || ''} ${escapeHtml(i.name)}</td>
        <td class="num" data-label="Amount">${money(i.amount)}</td>
        <td data-label="Status">${i.days <= 0 ? '<span class="badge crit">Due now</span>' : `<span class="badge ${i.days <= 3 ? 'warn' : ''}">in ${i.days} day${i.days === 1 ? '' : 's'}</span>`}</td>
        <td class="cell-muted" data-label="Date">${dateLabel(i.date)}</td>
      </tr>`).join('')}
    </tbody></table></div>
  </div>`;
}

// ---------------- Income ----------------
function incomeListFragment(data) {
  const list = data.income || [];
  const { pageItems, page, totalPages } = paginate('income', list);
  return `
    ${bulkDeleteBar('income')}
    <div class="table-wrap"><table class="data">
      <thead><tr><th style="width:1%">${selectAllCheckbox('income', pageItems.map(i => i.id))}</th><th>Source</th><th>Type</th><th>Frequency</th><th class="num">Amount</th><th class="num">Monthly</th><th></th></tr></thead>
      <tbody>
        ${pageItems.map(i => `<tr>
          <td>${selectCheckbox('income', i.id)}</td>
          <td class="cell-strong" data-label="Source">${escapeHtml(i.source)} ${autoBadge(i.accountId, data)}${i.notes ? `<div class="cell-muted">${escapeHtml(i.notes)}</div>` : ''}</td>
          <td data-label="Type"><span class="badge cat">${escapeHtml(i.type || 'net')}</span></td>
          <td data-label="Frequency">${FREQ_LABELS[i.frequency] || i.frequency}</td>
          <td class="num" data-label="Amount">${money(i.amount)}</td>
          <td class="num cell-strong" data-label="Monthly">${money(toMonthly(i.amount, i.frequency))}</td>
          <td>${rowActions('income', i.id)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    ${paginationBar('income', page, totalPages)}`;
}

export function renderIncome(data) {
  const list = data.income || [];
  if (!list.length) return empty('↗', 'No income yet', 'Add your salary, freelance work or any other income.', 'income');
  const totalMonthly = list.reduce((s, i) => s + toMonthly(i.amount, i.frequency), 0);
  return `
    ${summaryStrip([
      { label: 'Total monthly income', value: money(totalMonthly) },
      { label: 'Yearly', value: money(totalMonthly * 12, { cents: false }) },
      { label: 'Sources', value: num(list.length) },
    ])}
    <div id="list-income">${incomeListFragment(data)}</div>`;
}

// ---------------- Expenses ----------------
function expensesListFragment(data) {
  const list = data.expenses || [];
  const totalMonthly = list.reduce((s, e) => s + toMonthly(e.amount, e.frequency), 0);
  const sorted = [...list].sort((a, b) => toMonthly(b.amount, b.frequency) - toMonthly(a.amount, a.frequency));
  const { pageItems, page, totalPages } = paginate('expenses', sorted);
  return `
    ${bulkDeleteBar('expenses')}
    <div class="table-wrap"><table class="data">
      <thead><tr><th style="width:1%">${selectAllCheckbox('expenses', pageItems.map(e => e.id))}</th><th>Name</th><th>Category</th><th>Frequency</th><th class="num">Amount</th><th class="num">Monthly</th><th class="num">% of total</th><th></th></tr></thead>
      <tbody>
        ${pageItems.map(e => {
          const m = toMonthly(e.amount, e.frequency);
          return `<tr>
            <td>${selectCheckbox('expenses', e.id)}</td>
            <td class="cell-strong" data-label="Name">${escapeHtml(e.name)} ${autoBadge(e.accountId, data)}${e.notes ? `<div class="cell-muted">${escapeHtml(e.notes)}</div>` : ''}</td>
            <td data-label="Category"><span class="badge cat">${escapeHtml(e.category || 'Other')}</span></td>
            <td data-label="Frequency">${FREQ_LABELS[e.frequency] || e.frequency}</td>
            <td class="num" data-label="Amount">${money(e.amount)}</td>
            <td class="num cell-strong" data-label="Monthly">${money(m)}</td>
            <td class="num cell-muted" data-label="% of total">${totalMonthly > 0 ? pct(m / totalMonthly, 0) : '—'}</td>
            <td>${rowActions('expenses', e.id)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>
    ${paginationBar('expenses', page, totalPages)}`;
}

export function renderExpenses(data) {
  const list = data.expenses || [];
  const budgets = data.budgets || [];
  if (!list.length && !budgets.length) return empty('↘', 'No expenses yet', 'Track your rent, food, bills and everything else.', 'expenses');

  const totalMonthly = list.reduce((s, e) => s + toMonthly(e.amount, e.frequency), 0);
  const cats = spendingByCategory({ expenses: list });

  const expenseSection = !list.length
    ? `<div class="card">${empty('↘', 'No expenses yet', 'Track your rent, food, bills and everything else.', 'expenses')}</div>`
    : `
    ${summaryStrip([
      { label: 'Total monthly expenses', value: money(totalMonthly) },
      { label: 'Yearly', value: money(totalMonthly * 12, { cents: false }) },
      { label: 'Top category', value: cats[0] ? escapeHtml(cats[0].category) : '—' },
      { label: 'Line items', value: num(list.length) },
    ])}
    <div style="margin:20px 0">${spendingByCategoryPanel(data, { title: 'Spending by category' })}</div>
    <div id="list-expenses">${expensesListFragment(data)}</div>`;

  return `${expenseSection}${renderBudgetsPanel(data)}`;
}

function budgetsListFragment(data) {
  const statuses = budgetStatus(data);
  const statusColor = { good: 'var(--good)', warning: 'var(--warning)', serious: 'var(--serious)', critical: 'var(--critical)' };
  if (!statuses.length) return `<div class="text-muted" style="padding:12px 0">Set a monthly limit per category to track overspending.</div>`;
  const { pageItems, page, totalPages } = paginate('budgets', statuses);
  return `
    ${bulkToolbar('budgets', pageItems.map(s => s.id))}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px">
      ${pageItems.map(s => `<div class="panel">
        <div class="flex between center" style="margin-bottom:2px">
          <span class="flex center gap-8">${selectCheckbox('budgets', s.id)}<h3 style="margin:0">${escapeHtml(s.category)}</h3></span>
          ${rowActions('budgets', s.id)}
        </div>
        <div class="panel-sub"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${statusColor[s.level]};margin-right:6px"></span>${s.label}</div>
        ${progressBar(Math.min(1, s.pctUsed), { good: s.level === 'good' })}
        <div class="flex between" style="margin-top:10px;font-size:13px">
          <span class="text-muted">${money(s.actual)} of ${money(s.limit)}</span>
          <span class="${s.remaining >= 0 ? 'text-good' : 'text-crit'}">${s.remaining >= 0 ? `${money(s.remaining)} left` : `${money(-s.remaining)} over`}</span>
        </div>
      </div>`).join('')}
    </div>
    ${paginationBar('budgets', page, totalPages)}`;
}

function renderBudgetsPanel(data) {
  return `<div class="section" style="margin-top:28px">
    <div class="section-head"><h2>Budgets</h2>
      <button class="btn btn-sm btn-primary" data-add="budgets">+ Add budget</button>
    </div>
    <div id="list-budgets">${budgetsListFragment(data)}</div>
  </div>`;
}

// ---------------- Installments ----------------
function installmentsListFragment(data) {
  const list = data.installments || [];
  const rows = list.map(it => ({ it, st: installmentStatus(it) }));
  const { pageItems, page, totalPages } = paginate('installments', rows);
  return `
    ${bulkDeleteBar('installments')}
    <div class="table-wrap"><table class="data">
      <thead><tr><th style="width:1%">${selectAllCheckbox('installments', pageItems.map(r => r.it.id))}</th><th>Name</th><th class="num">Monthly</th><th class="num">Remaining</th><th style="min-width:160px">Progress</th><th>Payoff</th><th></th></tr></thead>
      <tbody>
        ${pageItems.map(({ it, st }) => `<tr>
          <td>${selectCheckbox('installments', it.id)}</td>
          <td class="cell-strong" data-label="Name">${escapeHtml(it.name)} ${autoBadge(it.accountId, data)}
            <div class="cell-muted">${money(it.principal)} @ ${num(it.apr || 0, (it.apr % 1 ? 2 : 0))}% · ${it.termMonths} mo</div></td>
          <td class="num cell-strong" data-label="Monthly">${money(st.monthlyPayment)}</td>
          <td class="num" data-label="Remaining">${money(st.remainingBalance)}</td>
          <td data-label="Progress">
            ${progressBar(st.progress, { good: !st.active })}
            <div class="cell-muted" style="margin-top:5px">${st.monthsPaid} of ${it.termMonths} paid</div>
          </td>
          <td data-label="Payoff">${st.active ? monthLabel(st.payoffDate) : '<span class="badge good">Paid off</span>'}</td>
          <td>${rowActions('installments', it.id)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    ${paginationBar('installments', page, totalPages)}`;
}

export function renderInstallments(data) {
  const list = data.installments || [];
  if (!list.length) return empty('▤', 'No installments yet', 'Add loans, financed purchases or any pay-over-time plans.', 'installments');
  const rows = list.map(it => ({ it, st: installmentStatus(it) }));
  const monthlyDebt = rows.filter(r => r.st.active).reduce((s, r) => s + r.st.monthlyPayment, 0);
  const totalRemaining = rows.reduce((s, r) => s + r.st.remainingBalance, 0);
  const totalInterest = rows.reduce((s, r) => s + r.st.totalInterest, 0);
  return `
    ${summaryStrip([
      { label: 'Monthly payments', value: money(monthlyDebt) },
      { label: 'Total remaining', value: money(totalRemaining, { cents: false }) },
      { label: 'Lifetime interest', value: money(totalInterest, { cents: false }) },
      { label: 'Active', value: `${num(rows.filter(r => r.st.active).length)} / ${num(list.length)}` },
    ])}
    <div id="list-installments">${installmentsListFragment(data)}</div>`;
}

// ---------------- Subscriptions ----------------
function subscriptionsListFragment(data) {
  const list = data.subscriptions || [];
  const sorted = [...list].map(s => ({ ...s, days: daysUntil(s.nextRenewal) }))
    .sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));
  const { pageItems, page, totalPages } = paginate('subscriptions', sorted);
  return `
    ${bulkDeleteBar('subscriptions')}
    <div class="table-wrap"><table class="data">
      <thead><tr><th style="width:1%">${selectAllCheckbox('subscriptions', pageItems.map(s => s.id))}</th><th>Service</th><th>Category</th><th>Cycle</th><th class="num">Amount</th><th class="num">Monthly</th><th>Next renewal</th><th></th></tr></thead>
      <tbody>
        ${pageItems.map(s => `<tr>
          <td>${selectCheckbox('subscriptions', s.id)}</td>
          <td class="cell-strong" data-label="Service">${escapeHtml(s.name)} ${autoBadge(s.accountId, data)}</td>
          <td data-label="Category"><span class="badge cat">${escapeHtml(s.category || 'Other')}</span></td>
          <td data-label="Cycle">${FREQ_LABELS[s.cycle] || s.cycle}</td>
          <td class="num" data-label="Amount">${money(s.amount)}</td>
          <td class="num cell-strong" data-label="Monthly">${money(toMonthly(s.amount, s.cycle))}</td>
          <td data-label="Next renewal">${s.nextRenewal ? `${dateLabel(s.nextRenewal)} ${renewalBadge(s.days)}` : '<span class="cell-muted">—</span>'}</td>
          <td>${rowActions('subscriptions', s.id)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    ${paginationBar('subscriptions', page, totalPages)}`;
}

export function renderSubscriptions(data) {
  const list = data.subscriptions || [];
  if (!list.length) return empty('⟳', 'No subscriptions yet', 'Track recurring services so nothing renews by surprise.', 'subscriptions');
  const monthly = list.reduce((s, x) => s + toMonthly(x.amount, x.cycle), 0);
  return `
    ${summaryStrip([
      { label: 'Monthly cost', value: money(monthly) },
      { label: 'Yearly cost', value: money(monthly * 12, { cents: false }) },
      { label: 'Services', value: num(list.length) },
    ])}
    <div id="list-subscriptions">${subscriptionsListFragment(data)}</div>`;
}

function renewalBadge(days) {
  if (days == null) return '';
  if (days <= 0) return '<span class="badge crit">due</span>';
  if (days <= 7) return `<span class="badge warn">${days}d</span>`;
  return '';
}

// ---------------- Savings ----------------
function savingsListFragment(data) {
  const list = data.savings || [];
  const transactions = data.transactions || [];
  const { pageItems, page, totalPages } = paginate('savings', list);
  return `
    ${bulkToolbar('savings', pageItems.map(sv => sv.id))}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
      ${pageItems.map(sv => {
        const saved = savingBalance(sv, transactions);
        const st = savingStatus({ ...sv, saved });
        const eta = st.complete ? 'Reached 🎉'
          : Number.isFinite(st.monthsToGoal) ? `~${monthLabel(st.projectedDate)}`
          : 'No monthly amount set';
        const track = st.onTrack == null ? '' : st.onTrack
          ? '<span class="badge good">On track</span>'
          : '<span class="badge warn">Behind</span>';
        return `<div class="panel">
          <div class="flex between center" style="margin-bottom:2px">
            <span class="flex center gap-8">${selectCheckbox('savings', sv.id)}<h3 style="margin:0">${escapeHtml(sv.name)}</h3></span>
            <span class="flex center" style="gap:4px">
              <button class="btn btn-ghost btn-icon btn-sm" data-add="transactions" data-add-prefill='{"type":"savings","savingId":"${sv.id}"}' title="Log a transaction for this saving" aria-label="Log transaction">＋</button>
              ${rowActions('savings', sv.id)}
            </span>
          </div>
          <div class="panel-sub">${st.hasTarget ? `${money(saved)} of ${money(sv.target)}` : `${money(saved)} saved`} ${track}</div>
          ${st.hasTarget ? `
            ${progressBar(st.progress, { good: st.complete, height: 10 })}
            <div class="flex between" style="margin-top:12px;font-size:13px">
              <span class="text-muted">${pct(st.progress, 0)} complete</span>
              <span>${money(st.remaining)} to go</span>
            </div>` : ''}
          <div class="flex between" style="margin-top:6px;font-size:13px">
            <span class="text-muted">Monthly</span><span>${money(sv.monthlyContribution || 0)}</span>
          </div>
          ${st.hasTarget ? `
            <div class="flex between" style="margin-top:6px;font-size:13px">
              <span class="text-muted">Est. completion</span><span>${eta}</span>
            </div>
            ${sv.deadline ? `<div class="flex between" style="margin-top:6px;font-size:13px"><span class="text-muted">Target date</span><span>${dateLabel(sv.deadline)}</span></div>` : ''}
            ${st.requiredMonthly != null && !st.complete ? `<div class="cell-muted" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">Save <strong>${money(st.requiredMonthly)}</strong>/mo to hit your deadline</div>` : ''}
          ` : ''}
        </div>`;
      }).join('')}
    </div>
    ${paginationBar('savings', page, totalPages)}`;
}

function txnSavingsListFragment(data) {
  const savings = data.savings || [];
  const accounts = data.accounts || [];
  const transactions = data.transactions || [];
  const savingName = id => savings.find(sv => sv.id === id)?.name || '—';
  const accountName = id => accounts.find(a => a.id === id)?.name || '—';
  const savingTxns = [...transactions]
    .filter(t => t.type === 'savings')
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (!savingTxns.length) return `<div class="text-muted" style="padding:12px 0">No savings transactions logged yet.</div>`;
  const { pageItems, page, totalPages } = paginate('txn-savings', savingTxns);

  return `
    ${bulkDeleteBar('transactions')}
    <div class="table-wrap"><table class="data">
      <thead><tr><th style="width:1%">${selectAllCheckbox('transactions', pageItems.map(t => t.id))}</th><th>Date</th><th>Description</th><th>Savings</th><th>Account</th><th>Effect</th><th class="num">Amount</th><th></th></tr></thead>
      <tbody>
        ${pageItems.map(t => `<tr>
          <td>${selectCheckbox('transactions', t.id)}</td>
          <td class="cell-muted" data-label="Date">${dateLabel(t.date)} ${scheduledBadge(t)}</td>
          <td class="cell-strong" data-label="Description">${escapeHtml(t.description)}${t.notes ? `<div class="cell-muted">${escapeHtml(t.notes)}</div>` : ''}</td>
          <td data-label="Savings">${escapeHtml(savingName(t.savingId))}</td>
          <td data-label="Account">${escapeHtml(accountName(t.accountId))}</td>
          <td data-label="Effect"><span class="badge ${t.savingDirection === 'withdraw' ? 'cat' : 'good'}">${t.savingDirection === 'withdraw' ? 'Withdraw' : 'Contribute'}</span></td>
          <td class="num ${t.savingDirection === 'withdraw' ? 'text-good' : 'text-crit'}" data-label="Amount">${t.savingDirection === 'withdraw' ? '+' : '−'}${money(t.amount)}</td>
          <td>${rowActions('transactions', t.id)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    ${paginationBar('txn-savings', page, totalPages)}`;
}

export function renderSavings(data) {
  const list = data.savings || [];
  if (!list.length) return empty('◎', 'No savings yet', 'Start a savings bucket — with or without a target — and move money into it.', 'savings');
  const transactions = data.transactions || [];
  const totalTarget = list.reduce((s, sv) => s + (Number(sv.target) || 0), 0);
  const totalSaved = list.reduce((s, sv) => s + savingBalance(sv, transactions), 0);
  const monthlyContrib = list.reduce((s, sv) => s + (savingStatus({ ...sv, saved: savingBalance(sv, transactions) }).complete ? 0 : Number(sv.monthlyContribution) || 0), 0);

  const ledger = `<div class="section">
    <div class="section-head"><h2>Savings transactions</h2>
      <button class="btn btn-sm btn-primary" data-add="transactions" data-add-prefill='{"type":"savings"}'>+ Add transaction</button>
    </div>
    <div id="list-txn-savings">${txnSavingsListFragment(data)}</div>
  </div>`;

  return `
    ${summaryStrip([
      { label: 'Saved so far', value: money(totalSaved, { cents: false }) },
      { label: 'Total targets', value: totalTarget > 0 ? money(totalTarget, { cents: false }) : '—' },
      { label: 'Monthly set aside', value: money(monthlyContrib) },
      { label: 'Overall progress', value: totalTarget > 0 ? pct(totalSaved / totalTarget, 0) : '—' },
    ])}
    <div id="list-savings">${savingsListFragment(data)}</div>
    ${ledger}`;
}

// ---------------- Pagination (any list) ----------------
// 20 is a deliberate middle ground: dense enough that most personal-finance
// lists (income sources, a year of subscriptions, a few months of
// transactions) fit on one page with no controls at all, but small enough
// that a page never turns into a long, heavy DOM dump — especially now that
// mobile renders each row as a multi-line stacked card, not a slim table row.
const PAGE_SIZE = 20;
const pageState = new Map(); // key -> current page (1-indexed)

function getPage(key) { return pageState.get(key) || 1; }
export function setPage(key, page) { pageState.set(key, Math.max(1, page)); }
export function resetPage(key) { pageState.delete(key); }
export function resetAllPages() { pageState.clear(); }

/** Slice `items` to the current page for `key`, clamping back if the list
 * shrank (e.g. the last item on the last page just got deleted). */
function paginate(key, items) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  let page = getPage(key);
  if (page > totalPages) { page = totalPages; pageState.set(key, page); }
  const start = (page - 1) * PAGE_SIZE;
  return { pageItems: items.slice(start, start + PAGE_SIZE), page, totalPages };
}

/** Below the threshold (== PAGE_SIZE), everything fits on one page, so no
 * controls render at all — nothing to click, nothing to explain. */
function paginationBar(key, page, totalPages) {
  if (totalPages <= 1) return '';
  return `<div class="pagination">
    <button class="btn btn-sm btn-ghost" data-page-nav="${key}:${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">‹ Prev</button>
    <span class="pagination-info">Page ${page} of ${totalPages}</span>
    <button class="btn btn-sm btn-ghost" data-page-nav="${key}:${page + 1}" ${page >= totalPages ? 'disabled' : ''} aria-label="Next page">Next ›</button>
  </div>`;
}

/** key -> function(data) that re-renders just that list's own fragment —
 * used so a Prev/Next click can patch a single container's innerHTML
 * instead of re-rendering the whole page (function declarations below are
 * hoisted, so referencing them here ahead of their definitions is safe). */
export const LIST_FRAGMENTS = {
  income: incomeListFragment,
  expenses: expensesListFragment,
  installments: installmentsListFragment,
  subscriptions: subscriptionsListFragment,
  savings: savingsListFragment,
  budgets: budgetsListFragment,
  debts: debtsListFragment,
  accounts: accountCardsFragment,
  'txn-accounts': txnAccountsListFragment,
  'txn-debts': txnDebtsListFragment,
  'txn-savings': txnSavingsListFragment,
};

// ---------------- Bulk select (any collection) ----------------
const selections = new Map(); // collection -> Set<id>
function selectionFor(collection) {
  if (!selections.has(collection)) selections.set(collection, new Set());
  return selections.get(collection);
}
export function toggleSelect(collection, id) {
  const sel = selectionFor(collection);
  sel.has(id) ? sel.delete(id) : sel.add(id);
}
export function selectAll(collection, ids, checked) {
  const sel = selectionFor(collection);
  ids.forEach(id => { checked ? sel.add(id) : sel.delete(id); });
}
export function clearSelection(collection) { selectionFor(collection).clear(); }
export function clearAllSelections() { selections.forEach(sel => sel.clear()); }
export function getSelectedIds(collection) { return [...selectionFor(collection)]; }
export function selectionCount(collection) { return selectionFor(collection).size; }

/** Checkbox-column header cell + bulk-delete toolbar button for a list of records. */
function selectAllCheckbox(collection, ids) {
  const sel = selectionFor(collection);
  const allSelected = ids.length > 0 && ids.every(id => sel.has(id));
  return `<label class="check-cell"><input type="checkbox" data-select-all="${collection}" ${allSelected ? 'checked' : ''}></label>`;
}
function selectCheckbox(collection, id) {
  return `<label class="check-cell"><input type="checkbox" data-select="${collection}:${id}" ${selectionFor(collection).has(id) ? 'checked' : ''}></label>`;
}
function bulkDeleteBar(collection) {
  const n = selectionCount(collection);
  if (!n) return '';
  return `<div class="flex center gap-8" style="margin-bottom:12px">
    <button class="btn btn-sm btn-danger" data-bulk-delete="${collection}">🗑 Delete selected (${n})</button>
  </div>`;
}

/** For card-grid views (no table header to host a "select all" checkbox):
 * an always-visible select-all toggle, plus the delete button once something's picked. */
function bulkToolbar(collection, ids) {
  const n = selectionCount(collection);
  // A plain <span> wrapper, not <label> — selectAllCheckbox() already returns
  // its own <label>, and nested <label> elements are invalid HTML and can
  // double-toggle inconsistently across browsers.
  return `<div class="flex center gap-8" style="margin-bottom:12px;flex-wrap:wrap">
    <span class="flex center gap-8" style="font-size:12px;color:var(--muted)">
      ${selectAllCheckbox(collection, ids)} <span>Select all</span>
    </span>
    ${n ? `<button class="btn btn-sm btn-danger" data-bulk-delete="${collection}">🗑 Delete selected (${n})</button>` : ''}
  </div>`;
}

// ---------------- Accounts ----------------
let accountFilter = null;
/** Select (or toggle off, if already selected) an account to filter the ledger by. */
export function setAccountFilter(id) { accountFilter = accountFilter === id ? null : id; clearSelection('transactions'); }
export function clearAccountFilter() { accountFilter = null; }

function accountCardsFragment(data) {
  const accounts = data.accounts || [];
  const transactions = data.transactions || [];
  const { pageItems, page, totalPages } = paginate('accounts', accounts);
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;margin:20px 0">
    ${pageItems.map(a => accountCard(a, transactions, a.id === accountFilter)).join('')}
  </div>
  ${paginationBar('accounts', page, totalPages)}`;
}

function txnAccountsListFragment(data) {
  const accounts = data.accounts || [];
  const transactions = data.transactions || [];
  const accountName = id => accounts.find(a => a.id === id)?.name || '—';
  const debtName = id => (data.debts || []).find(d => d.id === id)?.person || '—';
  const savingName = id => (data.savings || []).find(sv => sv.id === id)?.name || '—';

  const filtered = accountFilter
    ? transactions.filter(t => t.accountId === accountFilter || t.toAccountId === accountFilter)
    : transactions;
  const sorted = [...filtered].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (!sorted.length) {
    return `<div class="text-muted" style="padding:12px 0">${accountFilter ? 'No transactions for this account yet.' : 'No transactions logged yet.'}</div>`;
  }
  const { pageItems, page, totalPages } = paginate('txn-accounts', sorted);

  return `
    ${bulkDeleteBar('transactions')}
    <div class="table-wrap"><table class="data">
      <thead><tr>
        <th style="width:1%">${selectAllCheckbox('transactions', pageItems.map(t => t.id))}</th>
        <th>Date</th><th>Description</th><th>Category</th><th>Account</th><th class="num">Amount</th><th></th>
      </tr></thead>
      <tbody>
        ${pageItems.map(t => `<tr>
          <td>${selectCheckbox('transactions', t.id)}</td>
          <td class="cell-muted" data-label="Date">${dateLabel(t.date)} ${scheduledBadge(t)}</td>
          <td class="cell-strong" data-label="Description">${escapeHtml(t.description)}${t.notes ? `<div class="cell-muted">${escapeHtml(t.notes)}</div>` : ''}</td>
          <td data-label="Category"><span class="badge cat">${escapeHtml(t.category || 'Other')}</span></td>
          <td data-label="Account">${t.type === 'transfer' ? `${escapeHtml(accountName(t.accountId))} → ${escapeHtml(accountName(t.toAccountId))}`
            : t.type === 'debt' ? `Debt: ${escapeHtml(debtName(t.debtId))}`
            : t.type === 'savings' ? `${escapeHtml(accountName(t.accountId))} · Savings: ${escapeHtml(savingName(t.savingId))}`
            : escapeHtml(accountName(t.accountId))}</td>
          <td class="num ${t.type === 'income' || (t.type === 'savings' && t.savingDirection === 'withdraw') ? 'text-good' : t.type === 'expense' || (t.type === 'savings' && t.savingDirection === 'contribute') ? 'text-crit' : ''}" data-label="Amount">${t.type === 'expense' || (t.type === 'savings' && t.savingDirection === 'contribute') ? '−' : t.type === 'income' || (t.type === 'savings' && t.savingDirection === 'withdraw') ? '+' : ''}${money(t.amount)}</td>
          <td>${rowActions('transactions', t.id)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    ${paginationBar('txn-accounts', page, totalPages)}`;
}

export function renderAccounts(data) {
  const accounts = data.accounts || [];
  if (!accounts.length) return empty('◈', 'No accounts yet', 'Add a bank account, wallet or credit card to start tracking balances.', 'accounts');

  const s = accountsSummary(data);
  const due = paymentsDueThisMonth(data);
  const incoming = incomeDueThisMonth(data);
  const accountName = id => accounts.find(a => a.id === id)?.name || '—';

  const tiles = `<div class="stat-grid">
    ${clickableStat('cash', 'Total cash', money(s.totalCash))}
    ${clickableStat('credit', 'Total credit due', money(s.totalCreditOwed), s.totalCreditAvailable > 0 ? `${money(s.totalCreditAvailable)} available` : '')}
    ${statTile({ label: 'Balance', value: money(s.balance), sub: 'Cash minus credit — spendable now' })}
    ${statTile({ label: 'Net worth', value: money(currentNetWorth(data)), sub: 'Balance plus savings' })}
    ${clickableStat('incoming', 'Incoming this month', money(incoming.total), `${incoming.items.length} payment${incoming.items.length === 1 ? '' : 's'}`)}
    ${clickableStat('due', 'Due this month', money(due.total), `${due.items.length} payment${due.items.length === 1 ? '' : 's'}`)}
  </div>`;

  const cards = `<div id="list-accounts">${accountCardsFragment(data)}</div>`;
  const netWorthPanel = renderNetWorthPanel(data);

  const filterChip = accountFilter ? `
    <span class="badge cat">
      Showing: ${escapeHtml(accountName(accountFilter))}
      <button type="button" class="icon-btn-sm" data-clear-account-filter title="Show all accounts" style="margin-left:4px">✕</button>
    </span>` : '';

  const ledger = `<div class="section">
    <div class="section-head">
      <div class="flex center gap-8"><h2>Recent transactions</h2>${filterChip}</div>
      <div class="flex center gap-8">
        <a href="#transactions" class="btn btn-sm btn-ghost">View all →</a>
        <button class="btn btn-sm btn-primary" data-add="transactions">+ Add transaction</button>
      </div>
    </div>
    ${recentAccountsLedger(data)}
  </div>`;

  return `${tiles}${cards}${netWorthPanel}${ledger}`;
}

/** Compact, read-recent ledger for the Accounts page — most recent 10 rows,
 * respecting the account-card filter, with no pagination or bulk controls.
 * The full, filterable ledger lives on the Transactions view. */
function recentAccountsLedger(data) {
  const accounts = data.accounts || [];
  const transactions = data.transactions || [];
  const accountName = id => accounts.find(a => a.id === id)?.name || '—';
  const debtName = id => (data.debts || []).find(d => d.id === id)?.person || '—';
  const savingName = id => (data.savings || []).find(sv => sv.id === id)?.name || '—';
  const filtered = accountFilter
    ? transactions.filter(t => t.accountId === accountFilter || t.toAccountId === accountFilter)
    : transactions;
  const rows = [...filtered].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 10);
  if (!rows.length) {
    return `<div class="text-muted" style="padding:12px 0">${accountFilter ? 'No transactions for this account yet.' : 'No transactions logged yet.'}</div>`;
  }
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Account</th><th class="num">Amount</th><th></th></tr></thead>
    <tbody>
      ${rows.map(t => `<tr>
        <td class="cell-muted" data-label="Date">${dateLabel(t.date)} ${scheduledBadge(t)}</td>
        <td class="cell-strong" data-label="Description">${escapeHtml(t.description)}</td>
        <td data-label="Category"><span class="badge cat">${escapeHtml(t.category || 'Other')}</span></td>
        <td data-label="Account">${t.type === 'transfer' ? `${escapeHtml(accountName(t.accountId))} → ${escapeHtml(accountName(t.toAccountId))}`
          : t.type === 'debt' ? `Debt: ${escapeHtml(debtName(t.debtId))}`
          : t.type === 'savings' ? `${escapeHtml(accountName(t.accountId))} · Savings: ${escapeHtml(savingName(t.savingId))}`
          : escapeHtml(accountName(t.accountId))}</td>
        <td class="num ${t.type === 'income' || (t.type === 'savings' && t.savingDirection === 'withdraw') ? 'text-good' : t.type === 'expense' || (t.type === 'savings' && t.savingDirection === 'contribute') ? 'text-crit' : ''}" data-label="Amount">${t.type === 'expense' || (t.type === 'savings' && t.savingDirection === 'contribute') ? '−' : t.type === 'income' || (t.type === 'savings' && t.savingDirection === 'withdraw') ? '+' : ''}${money(t.amount)}</td>
        <td>${rowActions('transactions', t.id)}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

// ---------------- Transactions (top-level ledger) ----------------
// Search + filter controls are added in Phase 6; placeholder keeps the view self-contained until then.
function txnFilterControls() { return ''; }

export function renderTransactions(data) {
  const accounts = data.accounts || [];
  const transactions = data.transactions || [];
  if (!transactions.length && !accounts.length) {
    return `<div class="card">${empty('▤', 'No transactions yet', 'Add an account, then log income and spending to build your ledger.', 'accounts')}</div>`;
  }

  const posted = transactions.filter(t => !isScheduled(t));
  const moneyIn = posted.filter(t => t.type === 'income').reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const moneyOut = posted.filter(t => t.type === 'expense').reduce((s, t) => s + (Number(t.amount) || 0), 0);

  return `
    ${summaryStrip([
      { label: 'Transactions', value: num(transactions.length) },
      { label: 'Money in (posted)', value: money(moneyIn, { cents: false }) },
      { label: 'Money out (posted)', value: money(moneyOut, { cents: false }) },
    ])}
    ${txnFilterControls(data)}
    <div id="list-txn-accounts">${txnAccountsListFragment(data)}</div>`;
}

function renderNetWorthPanel(data) {
  const { opening, points } = netWorthHistory(data);
  const series = [{ date: null, balance: opening }, ...points];
  return `<div class="panel" style="margin-bottom:24px">
    <h3>Net worth over time</h3>
    <div class="panel-sub">Cash plus savings minus credit owed, from your opening balances through every logged transaction</div>
    ${lineChart(series)}
  </div>`;
}

function clickableStat(key, label, value, sub = '') {
  return `<button class="stat stat-click" type="button" data-drill="${key}">
    <div class="stat-label">${label}</div>
    <div class="stat-value tabular">${value}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
  </button>`;
}

const DRILL_TITLES = { cash: 'Cash accounts', credit: 'Credit accounts', incoming: 'Incoming this month', due: 'Due this month' };
const DRILL_KIND_LABELS = { subscription: 'Subscription', installment: 'Installment', expense: 'Expense', income: 'Income' };

export function drillDownTitle(key) { return DRILL_TITLES[key] || 'Details'; }

/** Itemized breakdown behind a clickable summary tile (cash / credit / incoming / due). */
export function renderDrillDown(key, data) {
  const accounts = data.accounts || [];
  const transactions = data.transactions || [];

  if (key === 'cash' || key === 'credit') {
    const wantCredit = key === 'credit';
    const list = accounts.filter(a => (a.type === 'credit') === wantCredit);
    if (!list.length) return `<div class="text-muted">No ${wantCredit ? 'credit cards' : 'cash accounts'} yet.</div>`;
    return `<div style="display:flex;flex-direction:column;gap:2px">
      ${list.map(a => {
        const bal = accountBalance(a, transactions);
        const limit = Number(a.creditLimit) || 0;
        return `<div class="flex between" style="padding:10px 0;border-bottom:1px solid var(--border-2)">
          <span>${escapeHtml(a.name)} <span class="text-muted" style="font-size:12px">(${titleCase(a.type)})</span></span>
          <strong>${money(bal)}${wantCredit && limit > 0 ? ` <span class="text-muted" style="font-weight:400">/ ${money(limit)}</span>` : ''}</strong>
        </div>`;
      }).join('')}
    </div>`;
  }

  const { items } = key === 'due' ? paymentsDueThisMonth(data) : incomeDueThisMonth(data);
  if (!items.length) return `<div class="text-muted">Nothing ${key === 'due' ? 'due' : 'incoming'} this month.</div>`;
  return `<div style="display:flex;flex-direction:column;gap:2px">
    ${items.map(i => `<div class="flex between" style="padding:10px 0;border-bottom:1px solid var(--border-2)">
      <span>${escapeHtml(i.name)} <span class="badge cat" style="margin-left:6px">${DRILL_KIND_LABELS[i.kind] || i.kind}</span></span>
      <strong>${money(i.amount)}</strong>
    </div>`).join('')}
    <div class="flex between" style="padding-top:12px;font-weight:600">
      <span>Total</span><strong>${money(items.reduce((s, i) => s + i.amount, 0))}</strong>
    </div>
  </div>`;
}

function accountCard(a, transactions, selected = false) {
  const bal = accountBalance(a, transactions);
  const isCredit = a.type === 'credit';
  const limit = Number(a.creditLimit) || 0;
  const util = isCredit && limit > 0 ? bal / limit : 0;
  return `<div class="panel account-card ${selected ? 'selected' : ''}" data-account-card="${a.id}" title="Click to show only this account's transactions">
    <div class="flex between center" style="margin-bottom:2px">
      <h3 style="margin:0">${escapeHtml(a.name)}</h3>
      ${rowActions('accounts', a.id)}
    </div>
    <div class="panel-sub">${titleCase(a.type)}</div>
    ${isCredit ? `
      <div class="flex between" style="margin-top:12px;font-size:13px"><span class="text-muted">Owed</span><span class="cell-strong">${money(bal)}</span></div>
      ${limit > 0 ? `
        ${progressBar(util, { good: util < 0.5 })}
        <div class="flex between" style="margin-top:6px;font-size:13px"><span class="text-muted">Available</span><span>${money(Math.max(0, limit - bal))} of ${money(limit)}</span></div>
      ` : ''}
    ` : `
      <div class="stat-value tabular" style="margin-top:8px">${money(bal)}</div>
    `}
  </div>`;
}

// ---------------- Debts ----------------
function debtsListFragment(data) {
  const debts = data.debts || [];
  const transactions = data.transactions || [];
  const { pageItems, page, totalPages } = paginate('debts', debts);
  return `
    ${bulkToolbar('debts', pageItems.map(d => d.id))}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;margin:20px 0">
      ${pageItems.map(d => {
        const bal = debtBalance(d, transactions);
        const owedByMe = d.direction === 'owed_by_me';
        return `<div class="panel">
          <div class="flex between center" style="margin-bottom:2px">
            <span class="flex center gap-8">${selectCheckbox('debts', d.id)}<h3 style="margin:0">${escapeHtml(d.person)}</h3></span>
            <span class="flex center" style="gap:4px">
              <button class="btn btn-ghost btn-icon btn-sm" data-add="transactions" data-add-prefill='{"type":"debt","debtId":"${d.id}"}' title="Log a transaction for this debt" aria-label="Log transaction">＋</button>
              ${rowActions('debts', d.id)}
            </span>
          </div>
          <div class="panel-sub">${owedByMe ? 'You owe them' : 'They owe you'}</div>
          <div class="stat-value tabular ${owedByMe ? 'text-crit' : 'text-good'}" style="margin-top:8px">${money(bal)}</div>
          ${d.notes ? `<div class="cell-muted" style="margin-top:8px">${escapeHtml(d.notes)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
    ${paginationBar('debts', page, totalPages)}`;
}

function txnDebtsListFragment(data) {
  const debts = data.debts || [];
  const transactions = data.transactions || [];
  const debtName = id => debts.find(d => d.id === id)?.person || '—';
  const debtTxns = [...transactions]
    .filter(t => t.type === 'debt')
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (!debtTxns.length) return `<div class="text-muted" style="padding:12px 0">No debt transactions logged yet.</div>`;
  const { pageItems, page, totalPages } = paginate('txn-debts', debtTxns);

  return `
    ${bulkDeleteBar('transactions')}
    <div class="table-wrap"><table class="data">
      <thead><tr><th style="width:1%">${selectAllCheckbox('transactions', pageItems.map(t => t.id))}</th><th>Date</th><th>Description</th><th>Person</th><th>Effect</th><th class="num">Amount</th><th></th></tr></thead>
      <tbody>
        ${pageItems.map(t => `<tr>
          <td>${selectCheckbox('transactions', t.id)}</td>
          <td class="cell-muted" data-label="Date">${dateLabel(t.date)} ${scheduledBadge(t)}</td>
          <td class="cell-strong" data-label="Description">${escapeHtml(t.description)}${t.notes ? `<div class="cell-muted">${escapeHtml(t.notes)}</div>` : ''}</td>
          <td data-label="Person">${escapeHtml(debtName(t.debtId))}</td>
          <td data-label="Effect"><span class="badge ${t.debtDirection === 'decrease' ? 'good' : 'cat'}">${t.debtDirection === 'decrease' ? 'Repayment' : 'Added'}</span></td>
          <td class="num" data-label="Amount">${money(t.amount)}</td>
          <td>${rowActions('transactions', t.id)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    ${paginationBar('txn-debts', page, totalPages)}`;
}

export function renderDebts(data) {
  const debts = data.debts || [];
  if (!debts.length) return empty('⇄', 'No debts yet', 'Track money people owe you, or money you owe them.', 'debts');

  const s = debtsSummary(data);

  const tiles = `<div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
    ${statTile({ label: 'Owed to you', value: money(s.totalOwedToMe) })}
    ${statTile({ label: 'You owe', value: money(s.totalOwedByMe) })}
    ${statTile({ label: 'Net', value: money(s.net), subClass: s.net >= 0 ? 'pos' : 'neg', sub: s.net >= 0 ? 'In your favor' : 'You\'re net negative' })}
  </div>`;

  const cards = `<div id="list-debts">${debtsListFragment(data)}</div>`;

  const ledger = `<div class="section">
    <div class="section-head"><h2>Debt transactions</h2>
      <button class="btn btn-sm btn-primary" data-add="transactions" data-add-prefill='{"type":"debt"}'>+ Add transaction</button>
    </div>
    <div id="list-txn-debts">${txnDebtsListFragment(data)}</div>
  </div>`;

  return `${tiles}${cards}${ledger}`;
}

function summaryStrip(items) {
  return `<div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:20px">
    ${items.map(i => `<div class="stat"><div class="stat-label">${i.label}</div><div class="stat-value tabular">${i.value}</div></div>`).join('')}
  </div>`;
}

// ---------------- Statement ----------------
// A statement is a report over an arbitrary period, so it carries its own
// little bit of UI state (which period is selected) the same module-level way
// accountFilter/spendMode do — no framework, just a variable + a setter.
const STATEMENT_PRESETS = [
  ['this-month', 'This month'], ['last-month', 'Last month'],
  ['this-quarter', 'This quarter'], ['this-year', 'This year'], ['all-time', 'All time'],
];

/** Compute the {from,to} ISO window for a named preset, off the local calendar. */
function presetRange(preset) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const first = (yy, mm) => iso(new Date(yy, mm, 1));
  const last = (yy, mm) => iso(new Date(yy, mm + 1, 0)); // day 0 of next month = last day of this one
  switch (preset) {
    case 'last-month': return { from: first(y, m - 1), to: last(y, m - 1) };
    case 'this-quarter': { const q = Math.floor(m / 3) * 3; return { from: first(y, q), to: last(y, q + 2) }; }
    case 'this-year': return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'all-time': return { from: '', to: iso(now) };
    case 'this-month':
    default: return { from: first(y, m), to: last(y, m) };
  }
}

let statementPeriod = null; // { preset, from, to }
function currentPeriod() {
  if (!statementPeriod) statementPeriod = { preset: 'this-month', ...presetRange('this-month') };
  return statementPeriod;
}
export function setStatementPreset(preset) {
  statementPeriod = { preset, ...presetRange(preset) };
}
/** A manual date-input edit — snaps the period to 'custom' and keeps the other bound. */
export function setStatementRange(from, to) {
  const p = currentPeriod();
  statementPeriod = { preset: 'custom', from: from ?? p.from, to: to ?? p.to };
}

function periodLabel(period) {
  if (period.preset && period.preset !== 'custom') {
    return STATEMENT_PRESETS.find(([k]) => k === period.preset)?.[1] || 'Custom period';
  }
  return `${period.from ? dateLabel(period.from) : 'the beginning'} – ${period.to ? dateLabel(period.to) : 'today'}`;
}

function periodSelector(period) {
  return `<div class="panel no-print" style="margin-bottom:20px">
    <div class="flex between center" style="flex-wrap:wrap;gap:14px">
      <div class="flex gap-8" role="group" aria-label="Statement period" style="flex-wrap:wrap">
        ${STATEMENT_PRESETS.map(([key, label]) => `
          <button type="button" class="btn btn-sm ${period.preset === key ? 'btn-primary' : 'btn-ghost'}" data-statement-preset="${key}" aria-pressed="${period.preset === key}">${label}</button>
        `).join('')}
      </div>
      <div class="flex center gap-8" style="flex-wrap:wrap">
        <label class="field-inline" style="font-size:12px;color:var(--muted)">From
          <input type="date" class="input input-sm" data-statement-date="from" value="${period.from || ''}" aria-label="From date">
        </label>
        <label class="field-inline" style="font-size:12px;color:var(--muted)">To
          <input type="date" class="input input-sm" data-statement-date="to" value="${period.to || ''}" aria-label="To date">
        </label>
      </div>
    </div>
  </div>`;
}

/** Human label for a transaction's counterparty column, mirroring the accounts ledger. */
function statementTarget(t, data) {
  const accountName = id => (data.accounts || []).find(a => a.id === id)?.name || '—';
  const debtName = id => (data.debts || []).find(d => d.id === id)?.person || '—';
  const savingName = id => (data.savings || []).find(sv => sv.id === id)?.name || '—';
  if (t.type === 'transfer') return `${escapeHtml(accountName(t.accountId))} → ${escapeHtml(accountName(t.toAccountId))}`;
  if (t.type === 'debt') return `Debt: ${escapeHtml(debtName(t.debtId))}`;
  if (t.type === 'savings') return `${escapeHtml(accountName(t.accountId))} · Savings: ${escapeHtml(savingName(t.savingId))}`;
  return escapeHtml(accountName(t.accountId));
}

export function renderStatement(data) {
  const transactions = data.transactions || [];
  const period = currentPeriod();

  const header = periodSelector(period);
  if (!transactions.length && !(data.accounts || []).length) {
    return `${header}<div class="card">${empty('▦', 'Nothing to report yet', 'Add accounts and log some transactions, then come back to generate a statement for any period.', 'accounts')}</div>`;
  }

  const st = statement(data, period.from, period.to);
  const printedRange = `<div class="statement-range flex between center" style="margin-bottom:20px;flex-wrap:wrap;gap:12px">
    <div>
      <h2 style="margin:0 0 2px">Statement — ${escapeHtml(periodLabel(period))}</h2>
      <div class="text-muted" style="font-size:13px">${st.from ? dateLabel(st.from) : 'Beginning'} to ${st.to ? dateLabel(st.to) : 'today'} · ${num(st.count)} transaction${st.count === 1 ? '' : 's'}</div>
    </div>
    <div class="flex gap-8 no-print">
      <button class="btn btn-sm" data-statement-export="csv">⬇ Export CSV</button>
      <button class="btn btn-sm btn-primary" data-statement-export="print">🖨 Print / PDF</button>
    </div>
  </div>`;

  const tiles = `<div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:20px">
    ${statTile({ label: 'Opening balance', value: money(st.openingBalance), sub: st.from ? dateLabel(st.from) : 'Start' })}
    ${statTile({ label: 'Money in', value: money(st.totalIncome), subClass: 'pos' })}
    ${statTile({ label: 'Money out', value: money(st.totalExpense), subClass: 'neg' })}
    ${statTile({ label: 'Closing balance', value: money(st.closingBalance), sub: st.to ? dateLabel(st.to) : 'Today' })}
    ${statTile({ label: 'Net change', value: money(st.net), sub: st.net >= 0 ? 'Surplus' : 'Shortfall', subClass: st.net >= 0 ? 'pos' : 'neg' })}
  </div>`;

  return `${header}${printedRange}${tiles}
    ${statementCategoryPanel(st)}
    ${statementAccountsPanel(st)}
    ${statementSavingsDebtPanel(st)}
    ${statementLedger(st, data)}`;
}

/** Plain-text (no HTML escaping) counterparty label for a transaction, for CSV/PDF. */
function statementTargetText(t, data) {
  const accountName = id => (data.accounts || []).find(a => a.id === id)?.name || '';
  const debtName = id => (data.debts || []).find(d => d.id === id)?.person || '';
  const savingName = id => (data.savings || []).find(sv => sv.id === id)?.name || '';
  if (t.type === 'transfer') return `${accountName(t.accountId)} → ${accountName(t.toAccountId)}`;
  if (t.type === 'debt') return `Debt: ${debtName(t.debtId)}`;
  if (t.type === 'savings') return `${accountName(t.accountId)} · Savings: ${savingName(t.savingId)}`;
  return accountName(t.accountId);
}

/**
 * The statement as a single, uniform CSV table — the same running-balance
 * register the view and PDF show, in bank-export shape: one header row, an
 * opening-balance row, one row per transaction (Money In / Money Out /
 * Balance), then a closing-balance row, and every Balance reconciles. Raw
 * numbers so a spreadsheet can total the columns. This is deliberately one
 * clean table, not a multi-section dump.
 */
export function statementCSV(data) {
  const period = currentPeriod();
  const st = statement(data, period.from, period.to);
  const r2 = n => (n ? Math.round(n * 100) / 100 : '');

  const rows = [['Date', 'Description', 'Type', 'Category', 'Account', 'Money In', 'Money Out', 'Balance', 'Scheduled', 'Notes']];
  rows.push([st.from || '', 'Opening balance', '', '', '', '', '', Math.round(st.openingBalance * 100) / 100, '', '']);
  st.register.forEach(r => rows.push([
    r.date || '', r.description || '', r.type || '', r.category || '', statementTargetText(r, data),
    r2(r.moneyIn), r2(r.moneyOut), Math.round(r.balance * 100) / 100,
    isScheduled(r) ? 'yes' : '', r.notes || '',
  ]));
  rows.push([st.to || '', 'Closing balance', '', '', '',
    Math.round(st.totalIncome * 100) / 100, Math.round(st.totalExpense * 100) / 100,
    Math.round(st.closingBalance * 100) / 100, '', '']);

  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return rows.map(r => r.map(q).join(',')).join('\r\n');
}

/** A filename-safe token for the current statement period, e.g. "2026-07-01_to_2026-07-31". */
export function statementFilename() {
  const p = currentPeriod();
  return `${p.from || 'start'}_to_${p.to || 'today'}`;
}

/**
 * A fully self-contained bank-statement document (its own <html>, inline
 * styles, light print theme) for the currently-selected period — rendered
 * into a hidden iframe and printed, so the PDF is a clean, uniform statement
 * independent of the app's on-screen theme and chrome. Same numbers as the
 * on-screen register and the CSV; they all come from statement().
 */
export function statementDocument(data) {
  const period = currentPeriod();
  const st = statement(data, period.from, period.to);
  const holder = (data.settings && data.settings.name) || 'Account holder';
  const cur = getCurrency();
  const cell = v => (v ? money(v) : '—');

  const accountRows = st.accountMovements.map(a => `<tr>
    <td>${escapeHtml(a.name)}</td><td>${titleCase(a.type)}</td>
    <td class="n">${money(a.opening)}</td><td class="n">${money(a.closing)}</td>
    <td class="n ${a.change > 0 ? 'pos' : a.change < 0 ? 'neg' : ''}">${a.change > 0 ? '+' : a.change < 0 ? '−' : ''}${money(Math.abs(a.change))}</td>
  </tr>`).join('');

  const categoryRows = st.byCategory.map(c => `<tr>
    <td>${escapeHtml(c.category)}</td>
    <td class="n">${money(c.amount)}</td>
    <td class="n">${st.totalExpense > 0 ? pct(c.amount / st.totalExpense, 0) : '—'}</td>
  </tr>`).join('');

  const registerRows = st.register.map(r => `<tr>
    <td class="nowrap">${dateLabel(r.date)}${isScheduled(r) ? ' <span class="sched">(scheduled)</span>' : ''}</td>
    <td>${escapeHtml(r.description)}${r.notes ? `<div class="sub">${escapeHtml(r.notes)}</div>` : ''}</td>
    <td>${titleCase(r.type || '')}</td>
    <td>${escapeHtml(statementTargetText(r, data))}</td>
    <td class="n pos">${cell(r.moneyIn)}</td>
    <td class="n neg">${cell(r.moneyOut)}</td>
    <td class="n">${money(r.balance)}</td>
  </tr>`).join('');

  const savingsBlock = (st.savings.contributed || st.savings.withdrawn) ? `<tr>
    <td>Savings</td><td class="n">${money(st.savings.contributed)} in</td>
    <td class="n">${money(st.savings.withdrawn)} out</td><td class="n">${money(st.savings.net)} net</td></tr>` : '';
  const debtBlock = (st.debts.increased || st.debts.decreased) ? `<tr>
    <td>Debts</td><td class="n">${money(st.debts.increased)} added</td>
    <td class="n">${money(st.debts.decreased)} repaid</td><td class="n">${money(st.debts.net)} net</td></tr>` : '';
  const movementBlock = (savingsBlock || debtBlock) ? `
    <h2>Savings &amp; debt movement</h2>
    <table class="movement"><tbody>${savingsBlock}${debtBlock}</tbody></table>` : '';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>GradPlan statement ${escapeHtml(st.from || '')} to ${escapeHtml(st.to || 'today')}</title>
<style>
  @page { margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 12px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; margin: 0; }
  .doc { max-width: 780px; margin: 0 auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a1a1a; padding-bottom: 14px; margin-bottom: 8px; }
  .brand { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
  .brand small { display: block; font-size: 11px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: #666; margin-top: 2px; }
  .meta { text-align: right; font-size: 11.5px; color: #444; }
  .meta strong { color: #1a1a1a; }
  .holder { margin: 14px 0 22px; font-size: 13px; }
  .holder .label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; }
  h2 { font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #444; border-bottom: 1px solid #ddd; padding-bottom: 5px; margin: 26px 0 10px; }
  .summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1px; background: #e2e2e2; border: 1px solid #e2e2e2; }
  .summary div { background: #fafafa; padding: 10px 12px; }
  .summary .k { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; }
  .summary .v { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; border-bottom: 1px solid #ccc; padding: 6px 8px; }
  td { padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .nowrap { white-space: nowrap; }
  .sub { color: #999; font-size: 10.5px; }
  .sched { color: #b8860b; font-size: 10px; }
  .pos { color: #1a7f37; } .neg { color: #b42318; }
  tr.boundary td { background: #f5f5f5; font-weight: 600; border-top: 1px solid #ccc; border-bottom: 1px solid #ccc; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 10px; color: #999; text-align: center; }
</style></head>
<body><div class="doc">
  <header>
    <div class="brand">GradPlan<small>Account statement</small></div>
    <div class="meta">
      <div><strong>Period</strong></div>
      <div>${st.from ? dateLabel(st.from) : 'Beginning'} – ${st.to ? dateLabel(st.to) : 'Today'}</div>
      <div style="margin-top:6px"><strong>Issued</strong> ${dateLabel(todayISO())}</div>
      <div>Currency ${escapeHtml(cur)}</div>
    </div>
  </header>

  <div class="holder">
    <div class="label">Statement for</div>
    <div>${escapeHtml(holder)}</div>
  </div>

  <div class="summary">
    <div><div class="k">Opening balance</div><div class="v">${money(st.openingBalance)}</div></div>
    <div><div class="k">Money in</div><div class="v pos">${money(st.totalIncome)}</div></div>
    <div><div class="k">Money out</div><div class="v neg">${money(st.totalExpense)}</div></div>
    <div><div class="k">Closing balance</div><div class="v">${money(st.closingBalance)}</div></div>
    <div><div class="k">Net change</div><div class="v ${st.net >= 0 ? 'pos' : 'neg'}">${money(st.net)}</div></div>
  </div>

  ${st.accountMovements.length ? `<h2>Account movements</h2>
  <table><thead><tr><th>Account</th><th>Type</th><th class="n">Opening</th><th class="n">Closing</th><th class="n">Change</th></tr></thead>
  <tbody>${accountRows}</tbody></table>` : ''}

  ${st.byCategory.length ? `<h2>Spending by category</h2>
  <table><thead><tr><th>Category</th><th class="n">Total</th><th class="n">% of spend</th></tr></thead>
  <tbody>${categoryRows}</tbody></table>` : ''}

  ${movementBlock}

  <h2>Transaction register</h2>
  ${st.register.length ? `<table>
    <thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Account</th><th class="n">Money in</th><th class="n">Money out</th><th class="n">Balance</th></tr></thead>
    <tbody>
      <tr class="boundary"><td class="nowrap">${st.from ? dateLabel(st.from) : '—'}</td><td colspan="3">Opening balance</td><td class="n">—</td><td class="n">—</td><td class="n">${money(st.openingBalance)}</td></tr>
      ${registerRows}
      <tr class="boundary"><td class="nowrap">${st.to ? dateLabel(st.to) : '—'}</td><td colspan="3">Closing balance</td><td class="n pos">${money(st.totalIncome)}</td><td class="n neg">${money(st.totalExpense)}</td><td class="n">${money(st.closingBalance)}</td></tr>
    </tbody></table>` : `<p style="color:#888">No transactions in this period. Opening and closing balance: ${money(st.openingBalance)}.</p>`}

  <footer>Generated by GradPlan on ${dateLabel(todayISO())} · For personal reference only</footer>
</div></body></html>`;
}

/** Spending-by-category breakdown for the period: donut + itemized table. */
function statementCategoryPanel(st) {
  if (!st.byCategory.length) {
    return `<div class="panel" style="margin-bottom:20px"><h3>Spending by category</h3>
      <div class="text-muted" style="padding:8px 0">No expense transactions in this period.</div></div>`;
  }
  return `<div class="panel" style="margin-bottom:20px">
    <h3>Spending by category</h3>
    <div class="panel-sub">Where money went over the period</div>
    ${donut(st.byCategory, { centerLabel: 'total out' })}
    <div class="table-wrap" style="margin-top:16px"><table class="data">
      <thead><tr><th>Category</th><th class="num">Total</th><th class="num">% of spend</th></tr></thead>
      <tbody>
        ${st.byCategory.map(c => `<tr>
          <td data-label="Category"><span class="badge cat">${escapeHtml(c.category)}</span></td>
          <td class="num cell-strong" data-label="Total">${money(c.amount)}</td>
          <td class="num cell-muted" data-label="% of spend">${st.totalExpense > 0 ? pct(c.amount / st.totalExpense, 0) : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </div>`;
}

/** How each account's balance moved across the period: opening → closing. */
function statementAccountsPanel(st) {
  if (!st.accountMovements.length) return '';
  return `<div class="panel" style="margin-bottom:20px">
    <h3>Account movements</h3>
    <div class="panel-sub">Opening and closing balance for each account over the period</div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Account</th><th>Type</th><th class="num">Opening</th><th class="num">Closing</th><th class="num">Change</th></tr></thead>
      <tbody>
        ${st.accountMovements.map(a => `<tr>
          <td class="cell-strong" data-label="Account">${escapeHtml(a.name)}</td>
          <td data-label="Type"><span class="badge cat">${titleCase(a.type)}</span></td>
          <td class="num" data-label="Opening">${money(a.opening)}</td>
          <td class="num" data-label="Closing">${money(a.closing)}</td>
          <td class="num ${a.change > 0 ? 'text-good' : a.change < 0 ? 'text-crit' : 'cell-muted'}" data-label="Change">${a.change > 0 ? '+' : a.change < 0 ? '−' : ''}${money(Math.abs(a.change))}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
  </div>`;
}

/** Savings and debt movement over the period (only shown if anything moved). */
function statementSavingsDebtPanel(st) {
  const sv = st.savings, db = st.debts;
  const hasSavings = sv.contributed || sv.withdrawn;
  const hasDebt = db.increased || db.decreased;
  if (!hasSavings && !hasDebt) return '';
  const panels = [];
  if (hasSavings) {
    panels.push(`<div class="panel">
      <h3>Savings movement</h3>
      ${miniRow('Contributed', `<span class="text-good">+${money(sv.contributed)}</span>`)}
      ${miniRow('Withdrawn', `<span class="text-crit">−${money(sv.withdrawn)}</span>`)}
      <div style="margin-top:6px;padding-top:8px;border-top:1px dashed var(--border)">
        ${miniRow('<strong>Net into savings</strong>', `<strong class="${sv.net >= 0 ? 'text-good' : 'text-crit'}">${money(sv.net)}</strong>`)}
      </div>
    </div>`);
  }
  if (hasDebt) {
    panels.push(`<div class="panel">
      <h3>Debt movement</h3>
      ${miniRow('Added / borrowed', money(db.increased))}
      ${miniRow('Repaid', money(db.decreased))}
      <div style="margin-top:6px;padding-top:8px;border-top:1px dashed var(--border)">
        ${miniRow('<strong>Net change</strong>', `<strong class="${db.net <= 0 ? 'text-good' : 'text-crit'}">${db.net >= 0 ? '+' : '−'}${money(Math.abs(db.net))}</strong>`)}
      </div>
    </div>`);
  }
  return `<div class="dash-grid" style="margin-bottom:20px">${panels.join('')}</div>`;
}

/**
 * The transaction register — a running-balance ledger like a bank statement:
 * an opening-balance row, one row per transaction with Money In / Money Out
 * and the balance after it, then a closing-balance row that reconciles.
 */
function statementLedger(st, data) {
  if (!st.register.length) {
    return `<div class="section">
      <div class="section-head"><h2>Transaction register</h2></div>
      <div class="text-muted" style="padding:12px 0">No transactions in this period. Opening and closing balance: ${money(st.openingBalance)}.</div>
    </div>`;
  }
  const inOut = v => v ? money(v) : '<span class="cell-muted">—</span>';
  return `<div class="section">
    <div class="section-head"><h2>Transaction register</h2></div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Category</th><th>Account</th><th class="num">Money in</th><th class="num">Money out</th><th class="num">Balance</th></tr></thead>
      <tbody>
        <tr class="statement-boundary">
          <td class="cell-muted" data-label="Date">${st.from ? dateLabel(st.from) : '—'}</td>
          <td class="cell-strong" data-label="Description" colspan="4">Opening balance</td>
          <td class="num cell-muted" data-label="Money in">—</td>
          <td class="num cell-muted" data-label="Money out">—</td>
          <td class="num cell-strong" data-label="Balance">${money(st.openingBalance)}</td>
        </tr>
        ${st.register.map(r => `<tr>
          <td class="cell-muted" data-label="Date">${dateLabel(r.date)} ${scheduledBadge(r)}</td>
          <td class="cell-strong" data-label="Description">${escapeHtml(r.description)}${r.notes ? `<div class="cell-muted">${escapeHtml(r.notes)}</div>` : ''}</td>
          <td data-label="Type">${titleCase(r.type || '')}</td>
          <td data-label="Category"><span class="badge cat">${escapeHtml(r.category || 'Other')}</span></td>
          <td data-label="Account">${statementTarget(r, data)}</td>
          <td class="num text-good" data-label="Money in">${inOut(r.moneyIn)}</td>
          <td class="num text-crit" data-label="Money out">${inOut(r.moneyOut)}</td>
          <td class="num tabular" data-label="Balance">${money(r.balance)}</td>
        </tr>`).join('')}
        <tr class="statement-boundary">
          <td class="cell-muted" data-label="Date">${st.to ? dateLabel(st.to) : '—'}</td>
          <td class="cell-strong" data-label="Description" colspan="2">Closing balance</td>
          <td data-label="Category"></td>
          <td data-label="Account"></td>
          <td class="num text-good cell-strong" data-label="Money in">${money(st.totalIncome)}</td>
          <td class="num text-crit cell-strong" data-label="Money out">${money(st.totalExpense)}</td>
          <td class="num cell-strong" data-label="Balance">${money(st.closingBalance)}</td>
        </tr>
      </tbody>
    </table></div>
  </div>`;
}
