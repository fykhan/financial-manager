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

/** Goal projection: months to reach target at the current contribution rate. */
export function goalStatus(goal, refISO) {
  const target = Number(goal.target) || 0;
  const saved = Math.min(Number(goal.saved) || 0, target || Infinity);
  const monthly = Number(goal.monthlyContribution) || 0;
  const remaining = Math.max(0, target - saved);
  const progress = target > 0 ? Math.min(1, saved / target) : 0;
  const monthsToGoal = remaining <= 0 ? 0 : (monthly > 0 ? Math.ceil(remaining / monthly) : Infinity);
  const projectedDate = Number.isFinite(monthsToGoal)
    ? addMonths(refISO || new Date().toISOString().slice(0, 10), monthsToGoal)
    : null;

  // Are we on track for a user-set deadline?
  let onTrack = null, requiredMonthly = null;
  if (goal.deadline) {
    const monthsLeft = Math.max(0, monthsBetween(refISO || new Date().toISOString().slice(0, 10), goal.deadline));
    requiredMonthly = monthsLeft > 0 ? remaining / monthsLeft : remaining;
    onTrack = remaining <= 0 ? true : monthly >= requiredMonthly - 0.5;
  }

  return { remaining, progress, monthsToGoal, projectedDate, onTrack, requiredMonthly, complete: remaining <= 0 };
}

/**
 * Aggregate every record into a single monthly financial summary.
 * data = { income[], expenses[], subscriptions[], installments[], goals[] }
 */
export function summary(data, refISO) {
  const income = data.income || [];
  const expenses = data.expenses || [];
  const subscriptions = data.subscriptions || [];
  const installments = data.installments || [];
  const goals = data.goals || [];

  const monthlyIncome = income.reduce((s, i) => s + toMonthly(i.amount, i.frequency), 0);

  const monthlyRecurringExpenses = expenses.reduce((s, e) => s + toMonthly(e.amount, e.frequency), 0);
  const monthlySubscriptions = subscriptions.reduce((s, x) => s + toMonthly(x.amount, x.cycle), 0);

  const activeInstallments = installments
    .map(it => ({ it, st: installmentStatus(it, refISO) }))
    .filter(x => x.st.active);
  const monthlyDebt = activeInstallments.reduce((s, x) => s + x.st.monthlyPayment, 0);
  const totalDebtRemaining = installments.reduce((s, it) => s + installmentStatus(it, refISO).remainingBalance, 0);

  const monthlyGoalContrib = goals.reduce((s, g) => {
    const st = goalStatus(g, refISO);
    return s + (st.complete ? 0 : (Number(g.monthlyContribution) || 0));
  }, 0);

  const monthlyExpenses = monthlyRecurringExpenses + monthlySubscriptions + monthlyDebt;
  const netCashFlow = monthlyIncome - monthlyExpenses;
  const leftoverAfterGoals = netCashFlow - monthlyGoalContrib;

  const savingsRate = monthlyIncome > 0 ? netCashFlow / monthlyIncome : 0;
  const dti = monthlyIncome > 0 ? monthlyDebt / monthlyIncome : 0;

  return {
    monthlyIncome,
    monthlyExpenses,
    monthlyRecurringExpenses,
    monthlySubscriptions,
    monthlyDebt,
    monthlyGoalContrib,
    netCashFlow,
    leftoverAfterGoals,
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
      goals: goals.length,
    },
  };
}

/** Monthly spending grouped by category (expenses + subscriptions + debt). */
export function spendingByCategory(data, refISO) {
  const map = new Map();
  const add = (cat, amt) => {
    if (amt <= 0) return;
    const key = cat || 'Other';
    map.set(key, (map.get(key) || 0) + amt);
  };
  (data.expenses || []).forEach(e => add(e.category, toMonthly(e.amount, e.frequency)));
  (data.subscriptions || []).forEach(s => add(s.category || 'Subscriptions', toMonthly(s.amount, s.cycle)));
  const debt = (data.installments || []).reduce((s, it) => {
    const st = installmentStatus(it, refISO);
    return s + (st.active ? st.monthlyPayment : 0);
  }, 0);
  add('Debt & loans', debt);

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
 * Cash-flow effect of one transaction on a given account, from the account's
 * own point of view (ignoring credit-vs-depository sign flip — see
 * accountBalance). Expense/income only count against their own accountId;
 * transfers count against both sides.
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
  return 0;
}

/**
 * Derived current balance for one account: its opening `balance` plus every
 * transaction that touches it. For a credit account `balance` means "amount
 * owed", so the literal cash delta is inverted — a charge (money "out")
 * increases what's owed, and a payment/transfer in reduces it.
 */
export function accountBalance(account, transactions) {
  const isCredit = account.type === 'credit';
  const delta = (transactions || []).reduce((s, t) => s + literalDelta(t, account.id), 0);
  return (Number(account.balance) || 0) + (isCredit ? -delta : delta);
}

/** Roll every account into cash-on-hand / credit-owed / credit-available / net worth. */
export function accountsSummary(data) {
  const accounts = data.accounts || [];
  const transactions = data.transactions || [];
  let totalCash = 0, totalCreditOwed = 0, totalCreditLimit = 0;
  accounts.forEach(a => {
    const bal = accountBalance(a, transactions);
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
    netWorth: totalCash - totalCreditOwed,
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
