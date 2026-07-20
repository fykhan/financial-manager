// views.js — renders each screen as an HTML string

import {
  summary, spendingByCategory, installmentStatus, savingStatus, savingBalance,
  toMonthly, FREQ_LABELS, assessSavingsRate, assessDTI, daysUntil,
  accountBalance, accountsSummary, paymentsDueThisMonth, incomeDueThisMonth,
  budgetStatus, netWorthHistory, currentNetWorth, debtBalance, debtsSummary, dueSoon,
  isScheduled, scheduledTransactions,
} from './calc.js';
import { donut, compareBars, progressBar, seriesColor, lineChart } from './charts.js';
import { money, moneyCompact, pct, num, dateLabel, monthLabel, escapeHtml, titleCase } from './format.js';

const VIEW_TITLES = {
  dashboard: 'Dashboard', income: 'Income', expenses: 'Expenses',
  installments: 'Installments', subscriptions: 'Subscriptions', savings: 'Savings',
  accounts: 'Accounts', debts: 'Debts',
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
            ${rowActions('savings', sv.id)}
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
      <button class="btn btn-sm btn-primary" data-add="transactions">+ Add transaction</button>
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
      <div class="flex center gap-8"><h2>Transactions</h2>${filterChip}</div>
      <button class="btn btn-sm btn-primary" data-add="transactions">+ Add transaction</button>
    </div>
    <div id="list-txn-accounts">${txnAccountsListFragment(data)}</div>
  </div>`;

  return `${tiles}${cards}${netWorthPanel}${ledger}`;
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
            ${rowActions('debts', d.id)}
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
      <button class="btn btn-sm btn-primary" data-add="transactions">+ Add transaction</button>
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
