"""Auto-pay catch-up (backend/recurring.py).

This is the only place the server writes rows the user didn't ask for, it runs
on every GET /api/data, and it was entirely untested. Dates are computed
relative to today via recurring's own _add_months, so the suite doesn't drift
with the calendar or depend on a frozen clock.
"""

from datetime import date, timedelta

import pytest
from sqlmodel import select

from backend.models import Expense, Installment, Transaction
from backend.recurring import MAX_CATCHUP_PERIODS, _add_months

TODAY = date.today()
ACCOUNT = {"id": "id_acc", "name": "Checking", "type": "checking", "balance": 5000}


def _months_ago(n):
    return _add_months(TODAY, -n).isoformat()


def _txns(client):
    return client.get("/api/data").json()["transactions"]


@pytest.fixture
def acct(client):
    client.post("/api/accounts", json=ACCOUNT)
    return client


def test_backdated_monthly_expense_backfills_and_advances(acct):
    acct.post("/api/expenses", json={
        "id": "id_e", "name": "Rent", "category": "Housing", "amount": 1200,
        "frequency": "monthly", "accountId": "id_acc", "nextDate": _months_ago(2),
    })
    data = acct.get("/api/data").json()

    posted = [t for t in data["transactions"] if t["description"] == "Rent"]
    assert len(posted) == 3  # T-2mo, T-1mo, T-0mo
    assert all(t["type"] == "expense" and t["accountId"] == "id_acc" for t in posted)

    dates = sorted(t["date"] for t in posted)
    assert dates[0] == _months_ago(2)
    assert dates == sorted(set(dates)), "posted dates must be strictly increasing"
    assert all(d <= TODAY.isoformat() for d in dates), "nothing may post ahead of today"
    # Exact later dates are deliberately not asserted: _add_months clamps to the
    # month length and the pointer advances from its own clamped value, so a
    # schedule anchored to the 29th-31st drifts down a day or three. See
    # test_installment_due_dates_stay_anchored_to_the_start_day, which covers
    # the installment side where the same drift used to cost a real payment.

    # pointer moved past today so a second load posts nothing more
    assert data["expenses"][0]["nextDate"] > TODAY.isoformat()

    assert len([t for t in _txns(acct) if t["description"] == "Rent"]) == 3


def test_weekly_income_backfills_every_week(acct):
    acct.post("/api/income", json={
        "id": "id_i", "source": "Shift work", "amount": 300, "frequency": "weekly",
        "type": "net", "accountId": "id_acc", "nextDate": (TODAY - timedelta(weeks=3)).isoformat(),
    })
    posted = [t for t in _txns(acct) if t["description"] == "Shift work"]
    assert len(posted) == 4  # -21, -14, -7, today
    assert all(t["type"] == "income" and t["category"] == "Income" for t in posted)


def test_future_dated_item_posts_nothing(acct):
    acct.post("/api/expenses", json={
        "id": "id_e", "name": "Later", "category": "Other", "amount": 50,
        "frequency": "monthly", "accountId": "id_acc",
        "nextDate": _add_months(TODAY, 1).isoformat(),
    })
    assert _txns(acct) == []


def test_one_time_frequency_never_recurs(acct):
    acct.post("/api/expenses", json={
        "id": "id_e", "name": "Deposit", "category": "Other", "amount": 500,
        "frequency": "one-time", "accountId": "id_acc", "nextDate": _months_ago(3),
    })
    assert _txns(acct) == []


def test_item_without_an_account_is_never_auto_paid(client):
    client.post("/api/expenses", json={
        "id": "id_e", "name": "Manual", "category": "Other", "amount": 50,
        "frequency": "monthly", "nextDate": _months_ago(3),
    })
    assert _txns(client) == []


def test_dangling_account_link_posts_nothing(client, session):
    """Guards the ghost-account case: a row whose account_id points at an
    account that no longer exists must not post forever."""
    session.add(Expense(id="id_e", name="Ghost", category="Other", amount=50,
                        frequency="monthly", account_id="id_gone",
                        next_date=_months_ago(3)))
    session.commit()

    assert _txns(client) == []
    # and the pointer was left alone rather than silently advanced
    assert session.exec(select(Expense)).one().next_date == _months_ago(3)


def test_subscription_renewals_use_the_subscription_category(acct):
    acct.post("/api/subscriptions", json={
        "id": "id_s", "name": "Streaming", "amount": 12, "cycle": "monthly",
        "category": "Entertainment", "accountId": "id_acc", "nextRenewal": _months_ago(1),
    })
    posted = [t for t in _txns(acct) if t["description"] == "Streaming"]
    assert len(posted) == 2
    assert {t["category"] for t in posted} == {"Entertainment"}


def _fully_paid_installment(client, start):
    client.post("/api/installments", json={
        "id": "id_n", "name": "Laptop", "principal": 1200, "apr": 0, "termMonths": 6,
        "monthlyPayment": 200, "startDate": start,
        "accountId": "id_acc", "nextDueDate": start,
    })
    return client.get("/api/data").json()


def test_installment_posts_payments_and_stops_before_the_final_date(acct):
    """A 6-month installment started 8 months ago is finished: payments post at
    the right amount and category, and the pointer parks on the final date
    rather than running past the end of the term."""
    start = "2026-02-15"  # mid-month: no day clamping anywhere in the schedule
    data = _fully_paid_installment(acct, start)

    posted = [t for t in data["transactions"] if t["description"] == "Laptop"]
    assert all(t["amount"] == 200 and t["category"] == "Debt & loans" for t in posted)

    final = _add_months(date.fromisoformat(start), 6).isoformat()
    assert data["installments"][0]["nextDueDate"] == final
    assert max(t["date"] for t in posted) < final


@pytest.mark.parametrize("start", ["2026-02-15", "2025-12-31", "2026-01-30", "2026-01-31", "2025-11-30"])
def test_installment_posts_exactly_term_months_payments(acct, start):
    """A 6-month term must debit the account six times, whatever day it starts on.

    Month-end starts used to post seven: due dates were walked forward from the
    previous (clamped) pointer, so the day ratcheted 31st -> 28th and never
    recovered, while final_date was computed once from the unclamped start_date.
    The drifted schedule then fit an extra payment under that boundary.
    """
    data = _fully_paid_installment(acct, start)
    posted = [t for t in data["transactions"] if t["description"] == "Laptop"]
    assert len(posted) == 6
    assert sum(t["amount"] for t in posted) == 1200  # never more than the principal


@pytest.mark.parametrize("start", ["2025-12-31", "2026-01-31", "2025-11-30"])
def test_installment_due_dates_stay_anchored_to_the_start_day(acct, start):
    """Each due date derives from start_date, so passing a short month must not
    permanently move the schedule: a 31st loan is due on the 31st again in March
    even though February pulled it back to the 28th."""
    data = _fully_paid_installment(acct, start)
    posted = sorted(t["date"] for t in data["transactions"] if t["description"] == "Laptop")

    s = date.fromisoformat(start)
    assert posted == [_add_months(s, n).isoformat() for n in range(6)]


def test_drifted_pointer_is_re_anchored_without_overpaying(acct, session):
    """A row left drifted by the old walk must snap back onto the true schedule
    and must not post the payment the drift would have allowed."""
    session.add(Installment(
        id="id_n", name="Laptop", principal=1200, apr=0, term_months=6,
        monthly_payment=200, start_date="2025-12-31",
        account_id="id_acc", next_due_date="2026-06-28",  # drifted; true date is 06-30
    ))
    session.commit()

    data = acct.get("/api/data").json()
    assert [t for t in data["transactions"] if t["description"] == "Laptop"] == []
    assert data["installments"][0]["nextDueDate"] == "2026-06-30"


def test_installment_without_a_payment_amount_uses_amortization(acct):
    """monthlyPayment is optional in the form ("leave blank to auto-calc"), so
    the catch-up has to derive it the same way calc.js does."""
    start = _months_ago(2)
    acct.post("/api/installments", json={
        "id": "id_n", "name": "Loan", "principal": 1200, "apr": 0, "termMonths": 12,
        "startDate": start, "accountId": "id_acc", "nextDueDate": start,
    })
    posted = [t for t in _txns(acct) if t["description"] == "Loan"]
    assert len(posted) == 3
    assert all(t["amount"] == pytest.approx(100) for t in posted)  # 1200 / 12


def test_catchup_is_capped_so_a_very_stale_date_cannot_run_away(acct):
    acct.post("/api/expenses", json={
        "id": "id_e", "name": "Ancient", "category": "Other", "amount": 5,
        "frequency": "monthly", "accountId": "id_acc", "nextDate": _months_ago(40),
    })
    posted = [t for t in _txns(acct) if t["description"] == "Ancient"]
    assert len(posted) == MAX_CATCHUP_PERIODS == 24


def test_catchup_is_idempotent_across_repeated_loads(acct):
    acct.post("/api/expenses", json={
        "id": "id_e", "name": "Rent", "category": "Housing", "amount": 1200,
        "frequency": "monthly", "accountId": "id_acc", "nextDate": _months_ago(2),
    })
    for _ in range(3):
        acct.get("/api/data")
    assert len([t for t in _txns(acct) if t["description"] == "Rent"]) == 3


def test_generated_transaction_ids_are_unique(acct, session):
    acct.post("/api/expenses", json={
        "id": "id_e", "name": "Rent", "category": "Housing", "amount": 1200,
        "frequency": "monthly", "accountId": "id_acc", "nextDate": _months_ago(5),
    })
    acct.get("/api/data")
    ids = [t.id for t in session.exec(select(Transaction)).all()]
    assert len(ids) == len(set(ids)) == 6
