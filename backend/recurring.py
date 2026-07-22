"""Auto-pay catch-up: for any income/expense/subscription/installment that has
an account linked, post a transaction (and advance its next date) for every
occurrence whose date has already arrived. Runs on every GET /api/data, so
opening the app is what "ticks the clock" — there's no background worker.

Mirrors public/js/calc.js's FREQ_PER_YEAR / amortizedPayment; kept separate
because this module posts to the ledger (a side effect), while calc.js stays
pure and DOM-free for the frontend's own display math.
"""

import calendar
import random
import string
from datetime import date, timedelta

from sqlmodel import Session, select

from backend.models import Account, Expense, Income, Installment, Subscription, Transaction

FREQ_PER_YEAR = {
    "weekly": 52,
    "biweekly": 26,
    "monthly": 12,
    "quarterly": 4,
    "semiannually": 2,
    "annually": 1,
    "one-time": 0,
}

MAX_CATCHUP_PERIODS = 24  # safety cap per record, in case a date is very stale


def _uid() -> str:
    return "id_" + "".join(random.choices(string.ascii_lowercase + string.digits, k=10))


def _add_months(d: date, months: int) -> date:
    total = d.month - 1 + months
    year = d.year + total // 12
    month = total % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def _advance(iso: str, frequency: str) -> str | None:
    d = date.fromisoformat(iso)
    if frequency == "weekly":
        return (d + timedelta(weeks=1)).isoformat()
    if frequency == "biweekly":
        return (d + timedelta(weeks=2)).isoformat()
    if frequency == "monthly":
        return _add_months(d, 1).isoformat()
    if frequency == "quarterly":
        return _add_months(d, 3).isoformat()
    if frequency == "semiannually":
        return _add_months(d, 6).isoformat()
    if frequency == "annually":
        return _add_months(d, 12).isoformat()
    return None  # one-time / unknown: never recurs


def _amortized_payment(principal: float, apr: float, term_months: int) -> float:
    if term_months <= 0:
        return 0
    r = (apr or 0) / 100 / 12
    if r == 0:
        return principal / term_months
    return (principal * r) / (1 - (1 + r) ** -term_months)


def apply_due_transactions(session: Session) -> None:
    today = date.today()
    new_txns: list[Transaction] = []
    # Guard against auto-pay links left dangling by a deleted account — without
    # this, a deleted account_id would post transactions to a ghost forever.
    account_ids = {a.id for a in session.exec(select(Account)).all()}

    for inc in session.exec(select(Income)).all():
        if inc.account_id not in account_ids or not inc.next_date or FREQ_PER_YEAR.get(inc.frequency, 0) <= 0:
            continue
        guard = 0
        while inc.next_date and date.fromisoformat(inc.next_date) <= today and guard < MAX_CATCHUP_PERIODS:
            new_txns.append(Transaction(
                id=_uid(), date=inc.next_date, description=inc.source, amount=inc.amount,
                type="income", category="Income", account_id=inc.account_id,
            ))
            inc.next_date = _advance(inc.next_date, inc.frequency)
            guard += 1
        session.add(inc)

    for exp in session.exec(select(Expense)).all():
        if exp.account_id not in account_ids or not exp.next_date or FREQ_PER_YEAR.get(exp.frequency, 0) <= 0:
            continue
        guard = 0
        while exp.next_date and date.fromisoformat(exp.next_date) <= today and guard < MAX_CATCHUP_PERIODS:
            new_txns.append(Transaction(
                id=_uid(), date=exp.next_date, description=exp.name, amount=exp.amount,
                type="expense", category=exp.category, account_id=exp.account_id,
            ))
            exp.next_date = _advance(exp.next_date, exp.frequency)
            guard += 1
        session.add(exp)

    for sub in session.exec(select(Subscription)).all():
        if sub.account_id not in account_ids or not sub.next_renewal or FREQ_PER_YEAR.get(sub.cycle, 0) <= 0:
            continue
        guard = 0
        while sub.next_renewal and date.fromisoformat(sub.next_renewal) <= today and guard < MAX_CATCHUP_PERIODS:
            new_txns.append(Transaction(
                id=_uid(), date=sub.next_renewal, description=sub.name, amount=sub.amount,
                type="expense", category=sub.category or "Subscriptions", account_id=sub.account_id,
            ))
            sub.next_renewal = _advance(sub.next_renewal, sub.cycle)
            guard += 1
        session.add(sub)

    for it in session.exec(select(Installment)).all():
        if it.account_id not in account_ids or not it.next_due_date or not it.start_date:
            continue
        final_date = _add_months(date.fromisoformat(it.start_date), it.term_months)
        payment = it.monthly_payment or _amortized_payment(it.principal, it.apr, it.term_months)
        guard = 0
        while (
            it.next_due_date
            and date.fromisoformat(it.next_due_date) <= today
            and date.fromisoformat(it.next_due_date) < final_date
            and guard < MAX_CATCHUP_PERIODS
        ):
            new_txns.append(Transaction(
                id=_uid(), date=it.next_due_date, description=it.name, amount=payment,
                type="expense", category="Debt & loans", account_id=it.account_id,
            ))
            it.next_due_date = _add_months(date.fromisoformat(it.next_due_date), 1).isoformat()
            guard += 1
        session.add(it)

    if new_txns:
        session.add_all(new_txns)
        session.commit()
