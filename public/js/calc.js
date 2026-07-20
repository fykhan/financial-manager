// calc.js — pure financial calculation engine (no DOM, fully testable)

/** Frequencies and how many times per year they occur. */
export const FREQ_PER_YEAR = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  quarterly: 4,
  semiannually: 2,
  annually: 1,
  'one-time': 0, // excluded from recurring monthly totals
};

export const FREQ_LABELS = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannually: 'Twice a year',
  annually: 'Yearly',
  'one-time': 'One-time',
};

/** Convert an amount at a given frequency to its monthly-equivalent value. */
export function toMonthly(amount, frequency) {
  const a = Number(amount) || 0;
  const per = FREQ_PER_YEAR[frequency];
  if (!per) return 0; // one-time or unknown => not a recurring monthly cost
  return (a * per) / 12;
}

/** Convert an amount at a given frequency to its yearly-equivalent value. */
export function toYearly(amount, frequency) {
  const a = Number(amount) || 0;
  const per = FREQ_PER_YEAR[frequency] || 0;
  return a * per;
}

const clampMonths = n => Math.max(0, Math.round(Number(n) || 0));

/** Whole months elapsed between an ISO date and a reference date (default now). */
export function monthsBetween(startISO, refISO) {
  if (!startISO) return 0;
  const start = new Date(startISO + (String(startISO).length === 10 ? 'T00:00:00' : ''));
  const ref = refISO ? new Date(refISO + (String(refISO).length === 10 ? 'T00:00:00' : '')) : new Date();
  if (isNaN(start) || isNaN(ref)) return 0;
  let months = (ref.getFullYear() - start.getFullYear()) * 12 + (ref.getMonth() - start.getMonth());
  if (ref.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
}

/** Add whole months to an ISO date, returning a new ISO date string. */
export function addMonths(startISO, months) {
  const d = new Date((startISO || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
  if (isNaN(d)) return null;
  d.setMonth(d.getMonth() + clampMonths(months));
  return d.toISOString().slice(0, 10);
}

/**
 * Full picture of an installment / loan.
 * Inputs: principal (original amount), monthlyPayment, termMonths, startDate, apr (annual %, optional).
 * If apr is provided we compute a proper amortization; otherwise a straight-line estimate.
 */
export function installmentStatus(it, refISO) {
  const principal = Number(it.principal) || 0;
  const term = clampMonths(it.termMonths);
  const apr = Number(it.apr) || 0;
  const monthsPaid = Math.min(term, monthsBetween(it.startDate, refISO));
  const monthsRemaining = Math.max(0, term - monthsPaid);

  // Monthly payment: use provided, else derive from amortization (or straight-line).
  let monthlyPayment = Number(it.monthlyPayment) || 0;
  if (!monthlyPayment && term > 0) {
    monthlyPayment = apr > 0 ? amortizedPayment(principal, apr, term) : principal / term;
  }

  const monthlyRate = apr / 100 / 12;
  let remainingBalance;
  if (apr > 0 && monthlyPayment > 0) {
    // Amortized outstanding balance after monthsPaid payments.
    const growth = Math.pow(1 + monthlyRate, monthsPaid);
    remainingBalance = principal * growth - monthlyPayment * ((growth - 1) / monthlyRate);
    remainingBalance = Math.max(0, remainingBalance);
  } else {
    // Straight-line: whatever principal has not yet been paid down.
    remainingBalance = Math.max(0, principal - monthlyPayment * monthsPaid);
  }

  const totalPaid = monthlyPayment * monthsPaid;
  const totalCost = monthlyPayment * term;
  const totalInterest = Math.max(0, totalCost - principal);
  const payoffDate = monthsRemaining > 0 ? addMonths(refISO || new Date().toISOString().slice(0, 10), monthsRemaining) : (refISO || new Date().toISOString().slice(0, 10));
  const progress = term > 0 ? Math.min(1, monthsPaid / term) : 0;

  return {
    monthlyPayment,
    monthsPaid,
    monthsRemaining,
    remainingBalance,
    totalPaid,
    totalCost,
    totalInterest,
    payoffDate,
    progress,
    active: monthsRemaining > 0,
  };
}

/** Standard amortized monthly payment for a loan. */
export function amortizedPayment(principal, apr, termMonths) {
  const p = Number(principal) || 0;
  const n = clampMonths(termMonths);
  const r = (Number(apr) || 0) / 100 / 12;
  if (n <= 0) return 0;
  if (r === 0) return p / n;
  return (p * r) / (1 - Math.pow(1 + r, -n));
}

/** Days until the next renewal of a subscription (negative => overdue). */
export function daysUntil(iso, refISO) {
  if (!iso) return null;
  const target = new Date(iso + 'T00:00:00');
  const ref = refISO ? new Date(refISO + 'T00:00:00') : new Date();
  if (isNaN(target) || isNaN(ref)) return null;
  return Math.round((target - ref) / 86400000);
}

/**
 * Savings projection: months to reach an (optional) target at the current
 * contribution rate. A saving with no target set is just a bucket money gets
 * moved into — there's no remaining/progress/ETA to project, so those come
 * back null and it's never "complete".
 */
export function savingStatus(saving, refISO) {
  const hasTarget = Number(saving.target) > 0;
  const target = hasTarget ? Number(saving.target) : 0;
  const saved = hasTarget ? Math.min(Number(saving.saved) || 0, target) : (Number(saving.saved) || 0);
  const monthly = Number(saving.monthlyContribution) || 0;
  const remaining = hasTarget ? Math.max(0, target - saved) : null;
  const progress = hasTarget ? Math.min(1, saved / target) : null;
  const monthsToGoal = !hasTarget ? null : (remaining <= 0 ? 0 : (monthly > 0 ? Math.ceil(remaining / monthly) : Infinity));
  const projectedDate = Number.isFinite(monthsToGoal)
    ? addMonths(refISO || new Date().toISOString().slice(0, 10), monthsToGoal)
    : null;

  // Are we on track for a user-set deadline?
  let onTrack = null, requiredMonthly = null;
  if (hasTarget && saving.deadline) {
    const monthsLeft = Math.max(0, monthsBetween(refISO || new Date().toISOString().slice(0, 10), saving.deadline));
    requiredMonthly = monthsLeft > 0 ? remaining / monthsLeft : remaining;
    onTrack = remaining <= 0 ? true : monthly >= requiredMonthly - 0.5;
  }

  return { hasTarget, remaining, progress, monthsToGoal, projectedDate, onTrack, requiredMonthly, complete: hasTarget && remaining <= 0 };
}

/**
 * Aggregate every record into a single monthly financial summary.
 * data = { income[], expenses[], subscriptions[], installments[], savings[] }
 */
export function summary(data, refISO) {
  const income = data.income || [];
  const expenses = data.expenses || [];
  const subscriptions = data.subscriptions || [];
  const installments = data.installments || [];
  const savings = data.savings || [];
  const transactions = data.transactions || [];

  const monthlyIncome = income.reduce((s, i) => s + toMonthly(i.amount, i.frequency), 0);

  const monthlyRecurringExpenses = expenses.reduce((s, e) => s + toMonthly(e.amount, e.frequency), 0);
  const monthlySubscriptions = subscriptions.reduce((s, x) => s + toMonthly(x.amount, x.cycle), 0);

  const activeInstallments = installments
    .map(it => ({ it, st: installmentStatus(it, refISO) }))
    .filter(x => x.st.active);
  const monthlyDebt = activeInstallments.reduce((s, x) => s + x.st.monthlyPayment, 0);
  const totalDebtRemaining = installments.reduce((s, it) => s + installmentStatus(it, refISO).remainingBalance, 0);

  const monthlySavingsContrib = savings.reduce((s, g) => {
    const st = savingStatus({ ...g, saved: savingBalance(g, transactions, refISO) }, refISO);
    return s + (st.complete ? 0 : (Number(g.monthlyContribution) || 0));
  }, 0);

  const monthlyExpenses = monthlyRecurringExpenses + monthlySubscriptions + monthlyDebt;
  const netCashFlow = monthlyIncome - monthlyExpenses;
  const leftoverAfterSavings = netCashFlow - monthlySavingsContrib;

  const savingsRate = monthlyIncome > 0 ? netCashFlow / monthlyIncome : 0;
  const dti = monthlyIncome > 0 ? monthlyDebt / monthlyIncome : 0;

  return {
    monthlyIncome,
    monthlyExpenses,
    monthlyRecurringExpenses,
    monthlySubscriptions,
    monthlyDebt,
    monthlySavingsContrib,
    netCashFlow,
    leftoverAfterSavings,
    savingsRate,
    dti,
    totalDebtRemaining,
    annualIncome: monthlyIncome * 12,
    annualExpenses: monthlyExpenses * 12,
    counts: {
      income: income.length,
      expenses: expenses.length,
      subscriptions: subscriptions.length,
      installments: installments.length,
      activeInstallments: activeInstallments.length,
      savings: savings.length,
    },
  };
}

/**
 * Monthly spending grouped by category. Three modes:
 *
 * - 'auto' (default) — a category is tracked against real money movement
 *   (this calendar month's expense transactions) instead of a fixed guessed
 *   amount whenever either (a) it has a Budget row, or (b) a transaction
 *   actually landed in it this month — real activity always wins over a
 *   projection, so the total stays truthful even for categories nobody set
 *   a budget on. Every other category uses the fixed monthly-equivalent
 *   (expenses + subscriptions + active installment debt). This is what
 *   budgetStatus and the summary math use — it's the one mode that never
 *   double-counts an auto-paid record against its own posted transaction.
 * - 'fixed' — every category uses only the fixed monthly-equivalent,
 *   ignoring budgets and transactions entirely (the pre-budgets behavior).
 * - 'transactions' — every category uses only this calendar month's real
 *   expense transactions, ignoring fixed records entirely.
 *
 * In every mode, a future-dated transaction (see isScheduled) hasn't
 * actually happened yet, so it's excluded from "real" spending regardless of
 * which calendar month it falls in.
 *
 * 'fixed' and 'transactions' are display-only alternate views (e.g. a
 * dashboard toggle) — callers that feed budgetStatus or summary() should
 * stick to the 'auto' default.
 */
export function spendingByCategory(data, refISO, mode = 'auto') {
  const map = new Map();
  const add = (cat, amt) => {
    if (amt <= 0) return;
    const key = cat || 'Other';
    map.set(key, (map.get(key) || 0) + amt);
  };

  let transactionSourced = new Set();
  if (mode === 'auto') {
    transactionSourced = new Set((data.budgets || []).map(b => b.category));
    (data.transactions || []).forEach(t => {
      if (t.type === 'expense' && inCalendarMonth(t.date, refISO) && !isFuture(t.date, refISO)) transactionSourced.add(t.category || 'Other');
    });
  }

  if (mode !== 'transactions') {
    (data.expenses || []).forEach(e => {
      if (!transactionSourced.has(e.category || 'Other')) add(e.category, toMonthly(e.amount, e.frequency));
    });
    (data.subscriptions || []).forEach(s => {
      const cat = s.category || 'Subscriptions';
      if (!transactionSourced.has(cat)) add(cat, toMonthly(s.amount, s.cycle));
    });
    if (!transactionSourced.has('Debt & loans')) {
      const debt = (data.installments || []).reduce((s, it) => {
        const st = installmentStatus(it, refISO);
        return s + (st.active ? st.monthlyPayment : 0);
      }, 0);
      add('Debt & loans', debt);
    }
  }

  if (mode !== 'fixed') {
    (data.transactions || []).forEach(t => {
      if (t.type === 'expense' && inCalendarMonth(t.date, refISO) && !isFuture(t.date, refISO)) add(t.category, Number(t.amount) || 0);
    });
  }

  return [...map.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Health assessment for a metric. Returns { level, label } where level is one of
 * good | warning | serious | critical, matching the reserved status palette.
 */
export function assessSavingsRate(rate) {
  if (rate >= 0.20) return { level: 'good', label: 'Healthy' };
  if (rate >= 0.10) return { level: 'warning', label: 'Okay' };
  if (rate >= 0) return { level: 'serious', label: 'Tight' };
  return { level: 'critical', label: 'Overspending' };
}

export function assessDTI(dti) {
  if (dti <= 0.20) return { level: 'good', label: 'Low' };
  if (dti <= 0.36) return { level: 'warning', label: 'Manageable' };
  if (dti <= 0.43) return { level: 'serious', label: 'Elevated' };
  return { level: 'critical', label: 'High' };
}

/**
 * A transaction dated after refISO (default today) hasn't happened yet — it's
 * scheduled, not posted. Every balance/summary function below excludes these
 * so a future-dated entry has no effect until its date actually arrives,
 * which happens for free on the next render since these all default refISO
 * to "now". scheduledTransactions() is the flip side: what got excluded, for
 * display as "upcoming".
 */
function isFuture(iso, refISO) {
  if (!iso) return false;
  return iso > (refISO || new Date().toISOString().slice(0, 10));
}

/** Is this transaction dated in the future relative to refISO (default today)? */
export function isScheduled(t, refISO) {
  return isFuture(t.date, refISO);
}

/** Every future-dated transaction — not yet posted to any balance — soonest first. */
export function scheduledTransactions(data, refISO) {
  return (data.transactions || [])
    .filter(t => isFuture(t.date, refISO))
    .slice()
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

/**
 * Cash-flow effect of one transaction on a given account, from the account's
 * own point of view (ignoring credit-vs-depository sign flip — see
 * accountBalance). Expense/income only count against their own accountId;
 * transfers count against both sides. A savings transaction counts like an
 * expense (contribute) or income (withdraw) against its accountId — see
 * savingBalance for the matching effect on the saving's own total.
 */
function literalDelta(t, accountId) {
  const amt = Number(t.amount) || 0;
  if (t.type === 'transfer') {
    if (t.accountId === accountId) return -amt;
    if (t.toAccountId === accountId) return amt;
    return 0;
  }
  if (t.accountId !== accountId) return 0;
  if (t.type === 'income') return amt;
  if (t.type === 'expense') return -amt;
  if (t.type === 'savings') return t.savingDirection === 'withdraw' ? amt : -amt;
  return 0;
}

/**
 * Derived current balance for one account: its opening `balance` plus every
 * already-posted transaction that touches it. For a credit account `balance`
 * means "amount owed", so the literal cash delta is inverted — a charge
 * (money "out") increases what's owed, and a payment/transfer in reduces it.
 * Future-dated transactions (see isScheduled) are excluded — they haven't
 * happened yet, so they don't move the balance until their date arrives.
 */
export function accountBalance(account, transactions, refISO) {
  const isCredit = account.type === 'credit';
  const delta = (transactions || [])
    .filter(t => !isFuture(t.date, refISO))
    .reduce((s, t) => s + literalDelta(t, account.id), 0);
  return (Number(account.balance) || 0) + (isCredit ? -delta : delta);
}

/**
 * Chronological running balance for one account: its opening balance, then
 * one point per calendar day that had at least one transaction touching it,
 * in date order. Same-day transactions collapse into a single point (the
 * balance at the end of that day). Future-dated transactions are excluded —
 * see accountBalance.
 */
export function accountBalanceHistory(account, transactions, refISO) {
  const isCredit = account.type === 'credit';
  const relevant = (transactions || [])
    .filter(t => (t.accountId === account.id || t.toAccountId === account.id) && !isFuture(t.date, refISO))
    .slice()
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const points = [];
  let running = Number(account.balance) || 0;
  let i = 0;
  while (i < relevant.length) {
    const day = relevant[i].date;
    let dayDelta = 0;
    while (i < relevant.length && relevant[i].date === day) {
      dayDelta += literalDelta(relevant[i], account.id);
      i++;
    }
    running += isCredit ? -dayDelta : dayDelta;
    points.push({ date: day, balance: running });
  }
  return points;
}

/**
 * Chronological net worth (total cash + total savings − total credit owed)
 * across everything the user owns. Savings count toward net worth because
 * it's still their money, just earmarked — a transfer between two of the
 * user's own accounts, paying down a credit card, or a savings contribution/
 * withdrawal all move money between buckets that are each already counted
 * here, so by construction none of them change the total — only income and
 * expense transactions actually move the line. Future-dated transactions are
 * excluded — see accountBalance.
 */
export function netWorthHistory(data, refISO) {
  const accounts = data.accounts || [];
  const savings = data.savings || [];
  const transactions = data.transactions || [];
  const opening = accounts.reduce((s, a) => s + (Number(a.balance) || 0) * (a.type === 'credit' ? -1 : 1), 0)
    + savings.reduce((s, sv) => s + (Number(sv.saved) || 0), 0);

  const sorted = transactions
    .filter(t => !isFuture(t.date, refISO))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const points = [];
  let running = opening;
  let i = 0;
  while (i < sorted.length) {
    const day = sorted[i].date;
    let dayDelta = 0;
    let moved = false; // a day with only transfers/savings moves doesn't touch net worth at all
    while (i < sorted.length && sorted[i].date === day) {
      const t = sorted[i];
      if (t.type === 'income') { dayDelta += Number(t.amount) || 0; moved = true; }
      else if (t.type === 'expense') { dayDelta -= Number(t.amount) || 0; moved = true; }
      i++;
    }
    if (moved) {
      running += dayDelta;
      points.push({ date: day, balance: running });
    }
  }
  return { opening, points };
}

/** Just the current (most recent) point of netWorthHistory, as a single number. */
export function currentNetWorth(data, refISO) {
  const { opening, points } = netWorthHistory(data, refISO);
  return points.length ? points[points.length - 1].balance : opening;
}

/**
 * Current outstanding amount for one debt: its opening `amount` plus every
 * already-posted 'debt' transaction logged against it. A transaction's
 * debtDirection is 'increase' (lend more / borrow more — grows what's
 * outstanding) or 'decrease' (a repayment — shrinks it), independent of
 * which way the debt itself runs (owed_to_me vs owed_by_me) — debts are
 * tracked on their own, not linked to any account. Future-dated transactions
 * are excluded — see accountBalance.
 */
export function debtBalance(debt, transactions, refISO) {
  const delta = (transactions || [])
    .filter(t => t.type === 'debt' && t.debtId === debt.id && !isFuture(t.date, refISO))
    .reduce((s, t) => s + (t.debtDirection === 'decrease' ? -(Number(t.amount) || 0) : (Number(t.amount) || 0)), 0);
  return (Number(debt.amount) || 0) + delta;
}

/**
 * Current saved amount for one saving: its opening `saved` plus every
 * already-posted 'savings' transaction logged against it. 'contribute' grows
 * it, 'withdraw' shrinks it — the mirror image of the debit/credit
 * literalDelta applies to the linked account, so the money is never
 * double-counted, only moved. Future-dated transactions are excluded — see
 * accountBalance.
 */
export function savingBalance(saving, transactions, refISO) {
  const delta = (transactions || [])
    .filter(t => t.type === 'savings' && t.savingId === saving.id && !isFuture(t.date, refISO))
    .reduce((s, t) => s + (t.savingDirection === 'withdraw' ? -(Number(t.amount) || 0) : (Number(t.amount) || 0)), 0);
  return (Number(saving.saved) || 0) + delta;
}

/** Roll every debt into what's owed to you vs. what you owe others. */
export function debtsSummary(data, refISO) {
  const debts = data.debts || [];
  const transactions = data.transactions || [];
  let totalOwedToMe = 0, totalOwedByMe = 0;
  debts.forEach(d => {
    const bal = debtBalance(d, transactions, refISO);
    if (d.direction === 'owed_by_me') totalOwedByMe += bal;
    else totalOwedToMe += bal;
  });
  return { totalOwedToMe, totalOwedByMe, net: totalOwedToMe - totalOwedByMe };
}

/**
 * Roll every account into cash-on-hand / credit-owed / credit-available /
 * balance. `balance` is spendable money (cash minus credit owed) — it
 * excludes savings, since that cash has been earmarked and moved out of the
 * accounts (see literalDelta's 'savings' handling). For total net worth,
 * which does count savings, see netWorthHistory.
 */
export function accountsSummary(data, refISO) {
  const accounts = data.accounts || [];
  const transactions = data.transactions || [];
  let totalCash = 0, totalCreditOwed = 0, totalCreditLimit = 0;
  accounts.forEach(a => {
    const bal = accountBalance(a, transactions, refISO);
    if (a.type === 'credit') {
      totalCreditOwed += bal;
      totalCreditLimit += Number(a.creditLimit) || 0;
    } else {
      totalCash += bal;
    }
  });
  return {
    totalCash,
    totalCreditOwed,
    totalCreditAvailable: Math.max(0, totalCreditLimit - totalCreditOwed),
    balance: totalCash - totalCreditOwed,
  };
}

/** Does an ISO date fall in the same calendar month as refISO (default now)? */
function inCalendarMonth(iso, refISO) {
  if (!iso) return false;
  const ref = refISO ? new Date(refISO + 'T00:00:00') : new Date();
  const d = new Date(iso + 'T00:00:00');
  return !isNaN(d) && d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

/**
 * Recurring obligations landing inside the current calendar month: dated
 * subscription renewals, active installment payments (due every month
 * they're active), and expenses that recur monthly or more often. An expense
 * with an auto-pay `nextDate` uses that date directly; one without any date
 * on record falls back to "monthly-or-more-frequent counts as due" since
 * there's nothing more precise to anchor it to.
 */
export function paymentsDueThisMonth(data, refISO) {
  const items = [];

  (data.subscriptions || []).forEach(s => {
    if (inCalendarMonth(s.nextRenewal, refISO)) {
      items.push({ kind: 'subscription', id: s.id, name: s.name, amount: Number(s.amount) || 0, date: s.nextRenewal });
    }
  });

  (data.installments || []).forEach(it => {
    const st = installmentStatus(it, refISO);
    if (st.active) {
      items.push({ kind: 'installment', id: it.id, name: it.name, amount: st.monthlyPayment, date: null });
    }
  });

  (data.expenses || []).forEach(e => {
    if (e.nextDate) {
      if (inCalendarMonth(e.nextDate, refISO)) {
        items.push({ kind: 'expense', id: e.id, name: e.name, amount: Number(e.amount) || 0, date: e.nextDate });
      }
      return;
    }
    const per = FREQ_PER_YEAR[e.frequency] || 0;
    if (per >= 12) {
      items.push({ kind: 'expense', id: e.id, name: e.name, amount: toMonthly(e.amount, e.frequency), date: null });
    }
  });

  return { items, total: items.reduce((s, i) => s + i.amount, 0) };
}

/**
 * Income landing inside the current calendar month — the incoming-money
 * counterpart to paymentsDueThisMonth. Same auto-pay-date-first, frequency-
 * fallback rule as expenses.
 */
export function incomeDueThisMonth(data, refISO) {
  const items = [];

  (data.income || []).forEach(i => {
    if (i.nextDate) {
      if (inCalendarMonth(i.nextDate, refISO)) {
        items.push({ kind: 'income', id: i.id, name: i.source, amount: Number(i.amount) || 0, date: i.nextDate });
      }
      return;
    }
    const per = FREQ_PER_YEAR[i.frequency] || 0;
    if (per >= 12) {
      items.push({ kind: 'income', id: i.id, name: i.source, amount: toMonthly(i.amount, i.frequency), date: null });
    }
  });

  return { items, total: items.reduce((s, i) => s + i.amount, 0) };
}

/**
 * Every dated, upcoming-or-just-overdue obligation — subscription renewals,
 * auto-pay expenses, auto-pay installments — within `days` of refISO
 * (default 14), soonest first. Unlike paymentsDueThisMonth (a calendar-month
 * total feeding the summary math), this only includes records that actually
 * carry a next-occurrence date, since there's nothing to sort or show a
 * countdown for on an undated recurring item — those are already reflected
 * in the monthly totals elsewhere on the dashboard.
 */
export function dueSoon(data, days = 14, refISO) {
  const items = [];

  (data.subscriptions || []).forEach(s => {
    if (!s.nextRenewal) return;
    const d = daysUntil(s.nextRenewal, refISO);
    if (d != null && d <= days) {
      items.push({ kind: 'subscription', id: s.id, name: s.name, amount: Number(s.amount) || 0, date: s.nextRenewal, days: d });
    }
  });

  (data.expenses || []).forEach(e => {
    if (!e.nextDate) return;
    const d = daysUntil(e.nextDate, refISO);
    if (d != null && d <= days) {
      items.push({ kind: 'expense', id: e.id, name: e.name, amount: Number(e.amount) || 0, date: e.nextDate, days: d });
    }
  });

  (data.installments || []).forEach(it => {
    if (!it.nextDueDate) return;
    const d = daysUntil(it.nextDueDate, refISO);
    if (d != null && d <= days) {
      const st = installmentStatus(it, refISO);
      items.push({ kind: 'installment', id: it.id, name: it.name, amount: st.monthlyPayment, date: it.nextDueDate, days: d });
    }
  });

  return items.sort((a, b) => a.days - b.days);
}

/**
 * Health assessment for a budget's usage fraction (actual / limit). Same
 * good | warning | serious | critical vocabulary as assessSavingsRate/assessDTI.
 */
export function assessBudget(pctUsed) {
  if (pctUsed <= 0.7) return { level: 'good', label: 'On track' };
  if (pctUsed <= 1) return { level: 'warning', label: 'Close to limit' };
  if (pctUsed <= 1.2) return { level: 'serious', label: 'Over budget' };
  return { level: 'critical', label: 'Way over' };
}

/**
 * Actual-vs-limit for each budget. spendingByCategory already sources a
 * budgeted category's "actual" from this month's real transactions (see its
 * own doc comment) — this just looks that number up per budget and compares
 * it to the limit.
 */
export function budgetStatus(data, refISO) {
  const budgets = data.budgets || [];
  const spendByCategory = new Map(spendingByCategory(data, refISO).map(s => [s.category, s.amount]));
  return budgets.map(b => {
    const actual = spendByCategory.get(b.category) || 0;
    const limit = Number(b.monthlyLimit) || 0;
    const pctUsed = limit > 0 ? actual / limit : (actual > 0 ? Infinity : 0);
    return {
      id: b.id,
      category: b.category,
      limit,
      actual,
      remaining: limit - actual,
      pctUsed,
      ...assessBudget(pctUsed),
    };
  });
}
