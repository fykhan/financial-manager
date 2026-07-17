// views.js — renders each screen as an HTML string

import {
  summary, spendingByCategory, installmentStatus, goalStatus,
  toMonthly, FREQ_LABELS, assessSavingsRate, assessDTI, daysUntil,
  accountBalance, accountsSummary, paymentsDueThisMonth, incomeDueThisMonth,
} from './calc.js';
import { donut, compareBars, progressBar, seriesColor } from './charts.js';
import { money, moneyCompact, pct, num, dateLabel, monthLabel, escapeHtml, titleCase } from './format.js';

const VIEW_TITLES = {
  dashboard: 'Dashboard', income: 'Income', expenses: 'Expenses',
  installments: 'Installments', subscriptions: 'Subscriptions', goals: 'Savings goals',
  accounts: 'Accounts',
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

// ---------------- Dashboard ----------------
export function renderDashboard(data) {
  const s = summary(data);
  const sr = assessSavingsRate(s.savingsRate);
  const dti = assessDTI(s.dti);
  const statusColor = { good: 'var(--good)', warning: 'var(--warning)', serious: 'var(--serious)', critical: 'var(--critical)' };

  if (s.counts.income === 0 && s.counts.expenses === 0 && s.counts.installments === 0 && s.counts.subscriptions === 0) {
    return `<div class="card">${empty('◧', 'Welcome to GradPlan', 'Add your income and expenses to see your full financial picture, or load sample data from ⚙ Data.', 'income')}</div>`;
  }

  const cats = spendingByCategory(data);
  const net = s.netCashFlow;

  const tiles = `<div class="stat-grid">
    ${statTile({ label: 'Monthly income', value: money(s.monthlyIncome), sub: `${money(s.annualIncome, { cents: false })} / year` })}
    ${statTile({ label: 'Monthly expenses', value: money(s.monthlyExpenses), sub: `incl. ${money(s.monthlyDebt)} debt` })}
    ${statTile({ label: 'Net cash flow', value: money(net), sub: net >= 0 ? 'Surplus each month' : 'Shortfall each month', subClass: net >= 0 ? 'pos' : 'neg' })}
    ${statTile({ label: 'Savings rate', value: pct(s.savingsRate, 0), sub: sr.label, dot: statusColor[sr.level] })}
  </div>`;

  const upcoming = upcomingRenewals(data);

  const panels = `<div class="dash-grid">
    <div class="panel">
      <h3>Where your money goes</h3>
      <div class="panel-sub">Monthly spending by category</div>
      ${donut(cats, { centerLabel: 'per month' })}
    </div>
    <div class="panel">
      <h3>Income vs. expenses</h3>
      <div class="panel-sub">Monthly comparison</div>
      ${compareBars([
        { label: 'Income', value: s.monthlyIncome, color: seriesColor(1) },
        { label: 'Expenses', value: s.monthlyExpenses, color: seriesColor(5) },
      ])}
      <div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--border)">
        ${miniRow('Recurring expenses', money(s.monthlyRecurringExpenses))}
        ${miniRow('Subscriptions', money(s.monthlySubscriptions))}
        ${miniRow('Debt payments', money(s.monthlyDebt))}
        ${miniRow('Goal contributions', money(s.monthlyGoalContrib))}
        <div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border)">
          ${miniRow('<strong>Left after goals</strong>', `<strong class="${s.leftoverAfterGoals >= 0 ? 'text-good' : 'text-crit'}">${money(s.leftoverAfterGoals)}</strong>`)}
        </div>
      </div>
    </div>
  </div>`;

  const health = `<div class="section" style="margin-top:24px">
    <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
      ${statTile({ label: 'Debt-to-income', value: pct(s.dti, 0), sub: dti.label, dot: statusColor[dti.level] })}
      ${statTile({ label: 'Total debt remaining', value: moneyCompact(s.totalDebtRemaining), sub: `${s.counts.activeInstallments} active installment${s.counts.activeInstallments === 1 ? '' : 's'}` })}
      ${statTile({ label: 'Active goals', value: num(s.counts.goals), sub: `${money(s.monthlyGoalContrib)}/mo set aside` })}
    </div>
  </div>`;

  const accountsRow = accountsOverviewRow(data);

  return `${tiles}${panels}${health}${accountsRow}${upcoming}`;
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
      ${statTile({ label: 'Incoming this month', value: money(incoming.total), sub: `${incoming.items.length} payment${incoming.items.length === 1 ? '' : 's'}` })}
      ${statTile({ label: 'Due this month', value: money(due.total), sub: `${due.items.length} payment${due.items.length === 1 ? '' : 's'}` })}
    </div>
  </div>`;
}

function miniRow(label, value) {
  return `<div class="flex between" style="padding:5px 0;font-size:13.5px"><span class="text-muted">${label}</span><span style="font-variant-numeric:tabular-nums">${value}</span></div>`;
}

function upcomingRenewals(data) {
  const items = (data.subscriptions || [])
    .filter(s => s.nextRenewal)
    .map(s => ({ ...s, days: daysUntil(s.nextRenewal) }))
    .filter(s => s.days != null && s.days <= 14)
    .sort((a, b) => a.days - b.days);
  if (!items.length) return '';
  return `<div class="section" style="margin-top:8px">
    <div class="section-head"><h2>⟳ Renewing soon</h2></div>
    <div class="table-wrap"><table class="data"><tbody>
      ${items.map(s => `<tr>
        <td class="cell-strong">${escapeHtml(s.name)}</td>
        <td class="num">${money(s.amount)}</td>
        <td>${s.days <= 0 ? '<span class="badge crit">Due now</span>' : `<span class="badge ${s.days <= 3 ? 'warn' : ''}">in ${s.days} day${s.days === 1 ? '' : 's'}</span>`}</td>
        <td class="cell-muted">${dateLabel(s.nextRenewal)}</td>
      </tr>`).join('')}
    </tbody></table></div>
  </div>`;
}

// ---------------- Income ----------------
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
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Source</th><th>Type</th><th>Frequency</th><th class="num">Amount</th><th class="num">Monthly</th><th></th></tr></thead>
      <tbody>
        ${list.map(i => `<tr>
          <td class="cell-strong">${escapeHtml(i.source)} ${autoBadge(i.accountId, data)}${i.notes ? `<div class="cell-muted">${escapeHtml(i.notes)}</div>` : ''}</td>
          <td><span class="badge cat">${escapeHtml(i.type || 'net')}</span></td>
          <td>${FREQ_LABELS[i.frequency] || i.frequency}</td>
          <td class="num">${money(i.amount)}</td>
          <td class="num cell-strong">${money(toMonthly(i.amount, i.frequency))}</td>
          <td>${rowActions('income', i.id)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

// ---------------- Expenses ----------------
export function renderExpenses(data) {
  const list = data.expenses || [];
  if (!list.length) return empty('↘', 'No expenses yet', 'Track your rent, food, bills and everything else.', 'expenses');
  const totalMonthly = list.reduce((s, e) => s + toMonthly(e.amount, e.frequency), 0);
  const cats = spendingByCategory({ expenses: list });
  const sorted = [...list].sort((a, b) => toMonthly(b.amount, b.frequency) - toMonthly(a.amount, a.frequency));
  return `
    ${summaryStrip([
      { label: 'Total monthly expenses', value: money(totalMonthly) },
      { label: 'Yearly', value: money(totalMonthly * 12, { cents: false }) },
      { label: 'Top category', value: cats[0] ? escapeHtml(cats[0].category) : '—' },
      { label: 'Line items', value: num(list.length) },
    ])}
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Name</th><th>Category</th><th>Frequency</th><th class="num">Amount</th><th class="num">Monthly</th><th class="num">% of total</th><th></th></tr></thead>
      <tbody>
        ${sorted.map(e => {
          const m = toMonthly(e.amount, e.frequency);
          return `<tr>
            <td class="cell-strong">${escapeHtml(e.name)} ${autoBadge(e.accountId, data)}${e.notes ? `<div class="cell-muted">${escapeHtml(e.notes)}</div>` : ''}</td>
            <td><span class="badge cat">${escapeHtml(e.category || 'Other')}</span></td>
            <td>${FREQ_LABELS[e.frequency] || e.frequency}</td>
            <td class="num">${money(e.amount)}</td>
            <td class="num cell-strong">${money(m)}</td>
            <td class="num cell-muted">${totalMonthly > 0 ? pct(m / totalMonthly, 0) : '—'}</td>
            <td>${rowActions('expenses', e.id)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
}

// ---------------- Installments ----------------
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
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Name</th><th class="num">Monthly</th><th class="num">Remaining</th><th style="min-width:160px">Progress</th><th>Payoff</th><th></th></tr></thead>
      <tbody>
        ${rows.map(({ it, st }) => `<tr>
          <td class="cell-strong">${escapeHtml(it.name)} ${autoBadge(it.accountId, data)}
            <div class="cell-muted">${money(it.principal)} @ ${num(it.apr || 0, (it.apr % 1 ? 2 : 0))}% · ${it.termMonths} mo</div></td>
          <td class="num cell-strong">${money(st.monthlyPayment)}</td>
          <td class="num">${money(st.remainingBalance)}</td>
          <td>
            ${progressBar(st.progress, { good: !st.active })}
            <div class="cell-muted" style="margin-top:5px">${st.monthsPaid} of ${it.termMonths} paid</div>
          </td>
          <td>${st.active ? monthLabel(st.payoffDate) : '<span class="badge good">Paid off</span>'}</td>
          <td>${rowActions('installments', it.id)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

// ---------------- Subscriptions ----------------
export function renderSubscriptions(data) {
  const list = data.subscriptions || [];
  if (!list.length) return empty('⟳', 'No subscriptions yet', 'Track recurring services so nothing renews by surprise.', 'subscriptions');
  const monthly = list.reduce((s, x) => s + toMonthly(x.amount, x.cycle), 0);
  const sorted = [...list].map(s => ({ ...s, days: daysUntil(s.nextRenewal) }))
    .sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));
  return `
    ${summaryStrip([
      { label: 'Monthly cost', value: money(monthly) },
      { label: 'Yearly cost', value: money(monthly * 12, { cents: false }) },
      { label: 'Services', value: num(list.length) },
    ])}
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Service</th><th>Category</th><th>Cycle</th><th class="num">Amount</th><th class="num">Monthly</th><th>Next renewal</th><th></th></tr></thead>
      <tbody>
        ${sorted.map(s => `<tr>
          <td class="cell-strong">${escapeHtml(s.name)} ${autoBadge(s.accountId, data)}</td>
          <td><span class="badge cat">${escapeHtml(s.category || 'Other')}</span></td>
          <td>${FREQ_LABELS[s.cycle] || s.cycle}</td>
          <td class="num">${money(s.amount)}</td>
          <td class="num cell-strong">${money(toMonthly(s.amount, s.cycle))}</td>
          <td>${s.nextRenewal ? `${dateLabel(s.nextRenewal)} ${renewalBadge(s.days)}` : '<span class="cell-muted">—</span>'}</td>
          <td>${rowActions('subscriptions', s.id)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

function renewalBadge(days) {
  if (days == null) return '';
  if (days <= 0) return '<span class="badge crit">due</span>';
  if (days <= 7) return `<span class="badge warn">${days}d</span>`;
  return '';
}

// ---------------- Goals ----------------
export function renderGoals(data) {
  const list = data.goals || [];
  if (!list.length) return empty('◎', 'No savings goals yet', 'Set targets — an emergency fund, a trip, a deposit — and track progress.', 'goals');
  const totalTarget = list.reduce((s, g) => s + (Number(g.target) || 0), 0);
  const totalSaved = list.reduce((s, g) => s + (Number(g.saved) || 0), 0);
  const monthlyContrib = list.reduce((s, g) => s + (goalStatus(g).complete ? 0 : Number(g.monthlyContribution) || 0), 0);
  return `
    ${summaryStrip([
      { label: 'Saved so far', value: money(totalSaved, { cents: false }) },
      { label: 'Total targets', value: money(totalTarget, { cents: false }) },
      { label: 'Monthly set aside', value: money(monthlyContrib) },
      { label: 'Overall progress', value: totalTarget > 0 ? pct(totalSaved / totalTarget, 0) : '—' },
    ])}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
      ${list.map(g => {
        const st = goalStatus(g);
        const eta = st.complete ? 'Reached 🎉'
          : Number.isFinite(st.monthsToGoal) ? `~${monthLabel(st.projectedDate)}`
          : 'No monthly amount set';
        const track = st.onTrack == null ? '' : st.onTrack
          ? '<span class="badge good">On track</span>'
          : '<span class="badge warn">Behind</span>';
        return `<div class="panel">
          <div class="flex between center" style="margin-bottom:2px">
            <h3 style="margin:0">${escapeHtml(g.name)}</h3>
            ${rowActions('goals', g.id)}
          </div>
          <div class="panel-sub">${money(g.saved || 0)} of ${money(g.target)} ${track}</div>
          ${progressBar(st.progress, { good: st.complete, height: 10 })}
          <div class="flex between" style="margin-top:12px;font-size:13px">
            <span class="text-muted">${pct(st.progress, 0)} complete</span>
            <span>${money(st.remaining)} to go</span>
          </div>
          <div class="flex between" style="margin-top:6px;font-size:13px">
            <span class="text-muted">Monthly</span><span>${money(g.monthlyContribution || 0)}</span>
          </div>
          <div class="flex between" style="margin-top:6px;font-size:13px">
            <span class="text-muted">Est. completion</span><span>${eta}</span>
          </div>
          ${g.deadline ? `<div class="flex between" style="margin-top:6px;font-size:13px"><span class="text-muted">Target date</span><span>${dateLabel(g.deadline)}</span></div>` : ''}
          ${st.requiredMonthly != null && !st.complete ? `<div class="cell-muted" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">Save <strong>${money(st.requiredMonthly)}</strong>/mo to hit your deadline</div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
}

// ---------------- Accounts ----------------
let accountFilter = null;
/** Select (or toggle off, if already selected) an account to filter the ledger by. */
export function setAccountFilter(id) { accountFilter = accountFilter === id ? null : id; }
export function clearAccountFilter() { accountFilter = null; }

export function renderAccounts(data) {
  const accounts = data.accounts || [];
  const transactions = data.transactions || [];
  if (!accounts.length) return empty('◈', 'No accounts yet', 'Add a bank account, wallet or credit card to start tracking balances.', 'accounts');

  const s = accountsSummary(data);
  const due = paymentsDueThisMonth(data);
  const incoming = incomeDueThisMonth(data);
  const accountName = id => accounts.find(a => a.id === id)?.name || '—';

  const tiles = `<div class="stat-grid">
    ${clickableStat('cash', 'Total cash', money(s.totalCash))}
    ${clickableStat('credit', 'Total credit due', money(s.totalCreditOwed), s.totalCreditAvailable > 0 ? `${money(s.totalCreditAvailable)} available` : '')}
    ${clickableStat('incoming', 'Incoming this month', money(incoming.total), `${incoming.items.length} payment${incoming.items.length === 1 ? '' : 's'}`)}
    ${clickableStat('due', 'Due this month', money(due.total), `${due.items.length} payment${due.items.length === 1 ? '' : 's'}`)}
  </div>`;

  const cards = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;margin:20px 0">
    ${accounts.map(a => accountCard(a, transactions, a.id === accountFilter)).join('')}
  </div>`;

  const filtered = accountFilter
    ? transactions.filter(t => t.accountId === accountFilter || t.toAccountId === accountFilter)
    : transactions;
  const sorted = [...filtered].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const filterChip = accountFilter ? `
    <span class="badge cat">
      Showing: ${escapeHtml(accountName(accountFilter))}
      <button type="button" data-clear-account-filter title="Show all accounts" style="all:unset;cursor:pointer;margin-left:4px">✕</button>
    </span>` : '';

  const ledger = `<div class="section">
    <div class="section-head">
      <div class="flex center gap-8"><h2>Transactions</h2>${filterChip}</div>
      <button class="btn btn-sm btn-primary" data-add="transactions">+ Add transaction</button>
    </div>
    ${!sorted.length ? `<div class="text-muted" style="padding:12px 0">${accountFilter ? 'No transactions for this account yet.' : 'No transactions logged yet.'}</div>` : `
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Account</th><th class="num">Amount</th><th></th></tr></thead>
      <tbody>
        ${sorted.map(t => `<tr>
          <td class="cell-muted">${dateLabel(t.date)}</td>
          <td class="cell-strong">${escapeHtml(t.description)}${t.notes ? `<div class="cell-muted">${escapeHtml(t.notes)}</div>` : ''}</td>
          <td><span class="badge cat">${escapeHtml(t.category || 'Other')}</span></td>
          <td>${t.type === 'transfer' ? `${escapeHtml(accountName(t.accountId))} → ${escapeHtml(accountName(t.toAccountId))}` : escapeHtml(accountName(t.accountId))}</td>
          <td class="num ${t.type === 'income' ? 'text-good' : t.type === 'expense' ? 'text-crit' : ''}">${t.type === 'expense' ? '−' : t.type === 'income' ? '+' : ''}${money(t.amount)}</td>
          <td>${rowActions('transactions', t.id)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`}
  </div>`;

  return `${tiles}${cards}${ledger}`;
}

function clickableStat(key, label, value, sub = '') {
  return `<button class="stat stat-click" type="button" data-drill="${key}">
    <div class="stat-label">${label}</div>
    <div class="stat-value tabular">${value}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
  </button>`;
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

function summaryStrip(items) {
  return `<div class="stat-grid" style="grid-template-columns:repeat(${items.length},1fr);margin-bottom:20px">
    ${items.map(i => `<div class="stat"><div class="stat-label">${i.label}</div><div class="stat-value tabular">${i.value}</div></div>`).join('')}
  </div>`;
}
