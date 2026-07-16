// Unit tests for the calculation engine — run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toMonthly, toYearly, monthsBetween, addMonths, amortizedPayment,
  installmentStatus, goalStatus, summary, spendingByCategory,
  assessSavingsRate, assessDTI, daysUntil,
} from '../public/js/calc.js';

const approx = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('toMonthly normalizes each frequency', () => {
  approx(toMonthly(1200, 'monthly'), 1200);
  approx(toMonthly(1200, 'annually'), 100);
  approx(toMonthly(300, 'quarterly'), 100);
  approx(toMonthly(100, 'weekly'), 100 * 52 / 12);
  approx(toMonthly(100, 'biweekly'), 100 * 26 / 12);
  approx(toMonthly(600, 'semiannually'), 100);
  assert.equal(toMonthly(500, 'one-time'), 0);
  assert.equal(toMonthly(500, 'nonsense'), 0);
});

test('toYearly is the inverse scale', () => {
  approx(toYearly(100, 'monthly'), 1200);
  approx(toYearly(50, 'weekly'), 2600);
  assert.equal(toYearly(500, 'one-time'), 0);
});

test('monthsBetween counts whole elapsed months', () => {
  assert.equal(monthsBetween('2026-01-15', '2026-07-15'), 6);
  assert.equal(monthsBetween('2026-01-15', '2026-07-10'), 5); // day not yet reached
  assert.equal(monthsBetween('2026-07-15', '2026-01-15'), 0); // future start clamps to 0
  assert.equal(monthsBetween('', '2026-07-15'), 0);
});

test('addMonths rolls the calendar forward', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-03-03'); // JS date roll (Feb overflow)
  assert.equal(addMonths('2026-07-15', 6), '2027-01-15');
  assert.equal(addMonths('2026-07-15', 0), '2026-07-15');
});

test('amortizedPayment matches the standard loan formula', () => {
  // 24000 @ 4.5% for 120 months ≈ 248.71/mo
  approx(amortizedPayment(24000, 4.5, 120), 248.71, 0.5);
  // zero interest is straight division
  approx(amortizedPayment(1200, 0, 12), 100);
  assert.equal(amortizedPayment(1000, 5, 0), 0);
});

test('installmentStatus (interest-free, straight line)', () => {
  const it = { principal: 1200, monthlyPayment: 100, termMonths: 12, startDate: '2026-01-15', apr: 0 };
  const st = installmentStatus(it, '2026-07-15');
  assert.equal(st.monthsPaid, 6);
  assert.equal(st.monthsRemaining, 6);
  approx(st.remainingBalance, 600);
  approx(st.totalInterest, 0);
  assert.equal(st.active, true);
  approx(st.progress, 0.5);
});

test('installmentStatus (with APR) reduces balance via amortization', () => {
  const it = { principal: 24000, monthlyPayment: 248.71, termMonths: 120, startDate: '2026-01-15', apr: 4.5 };
  const st = installmentStatus(it, '2026-07-15'); // 6 payments in
  assert.equal(st.monthsPaid, 6);
  assert.ok(st.remainingBalance < 24000 && st.remainingBalance > 22000, `balance ${st.remainingBalance}`);
  assert.ok(st.totalInterest > 5000, `interest ${st.totalInterest}`);
});

test('installmentStatus auto-derives payment when none given', () => {
  const it = { principal: 1200, termMonths: 12, startDate: '2026-07-15', apr: 0 };
  const st = installmentStatus(it, '2026-07-15');
  approx(st.monthlyPayment, 100);
});

test('installmentStatus marks a finished loan inactive', () => {
  const it = { principal: 1200, monthlyPayment: 100, termMonths: 12, startDate: '2024-01-15', apr: 0 };
  const st = installmentStatus(it, '2026-07-15');
  assert.equal(st.active, false);
  assert.equal(st.monthsRemaining, 0);
  approx(st.remainingBalance, 0);
});

test('goalStatus projects months and tracks deadline feasibility', () => {
  const g = { target: 10000, saved: 2400, monthlyContribution: 400, deadline: '' };
  const st = goalStatus(g, '2026-07-15');
  approx(st.remaining, 7600);
  assert.equal(st.monthsToGoal, 19); // ceil(7600/400)
  assert.equal(st.complete, false);

  const done = goalStatus({ target: 1000, saved: 1000, monthlyContribution: 0 }, '2026-07-15');
  assert.equal(done.complete, true);
  assert.equal(done.monthsToGoal, 0);

  const noContrib = goalStatus({ target: 1000, saved: 0, monthlyContribution: 0 }, '2026-07-15');
  assert.equal(noContrib.monthsToGoal, Infinity);
});

test('goalStatus flags behind-schedule against a deadline', () => {
  const behind = goalStatus({ target: 12000, saved: 0, monthlyContribution: 100, deadline: '2027-07-15' }, '2026-07-15');
  assert.equal(behind.onTrack, false); // needs 1000/mo, only saving 100
  const ahead = goalStatus({ target: 1200, saved: 0, monthlyContribution: 200, deadline: '2027-07-15' }, '2026-07-15');
  assert.equal(ahead.onTrack, true);
});

test('summary aggregates the whole picture', () => {
  const data = {
    income: [{ amount: 3800, frequency: 'monthly' }, { amount: 1200, frequency: 'annually' }], // 3800 + 100
    expenses: [{ amount: 1200, frequency: 'monthly', category: 'Housing' }],
    subscriptions: [{ amount: 12, cycle: 'monthly', category: 'Fun' }],
    installments: [{ principal: 1200, monthlyPayment: 100, termMonths: 12, startDate: '2026-06-15', apr: 0 }],
    goals: [{ target: 5000, saved: 0, monthlyContribution: 300 }],
  };
  const s = summary(data, '2026-07-15');
  approx(s.monthlyIncome, 3900);
  approx(s.monthlyDebt, 100);
  approx(s.monthlyExpenses, 1200 + 12 + 100);
  approx(s.netCashFlow, 3900 - 1312);
  approx(s.leftoverAfterGoals, 3900 - 1312 - 300);
  approx(s.savingsRate, (3900 - 1312) / 3900, 0.001);
  approx(s.dti, 100 / 3900, 0.001);
  assert.equal(s.counts.activeInstallments, 1);
});

test('spendingByCategory groups and sorts descending', () => {
  const data = {
    expenses: [
      { amount: 1200, frequency: 'monthly', category: 'Housing' },
      { amount: 100, frequency: 'monthly', category: 'Housing' },
      { amount: 300, frequency: 'monthly', category: 'Food' },
    ],
    subscriptions: [{ amount: 12, cycle: 'monthly', category: 'Fun' }],
    installments: [],
  };
  const cats = spendingByCategory(data, '2026-07-15');
  assert.equal(cats[0].category, 'Housing');
  approx(cats[0].amount, 1300);
  assert.equal(cats[1].category, 'Food');
});

test('health assessments map to status levels', () => {
  assert.equal(assessSavingsRate(0.25).level, 'good');
  assert.equal(assessSavingsRate(0.12).level, 'warning');
  assert.equal(assessSavingsRate(0.02).level, 'serious');
  assert.equal(assessSavingsRate(-0.1).level, 'critical');
  assert.equal(assessDTI(0.1).level, 'good');
  assert.equal(assessDTI(0.5).level, 'critical');
});

test('daysUntil computes signed day distance', () => {
  assert.equal(daysUntil('2026-07-25', '2026-07-15'), 10);
  assert.equal(daysUntil('2026-07-10', '2026-07-15'), -5);
  assert.equal(daysUntil('', '2026-07-15'), null);
});
