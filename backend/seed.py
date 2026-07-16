"""Sample dataset, ported 1:1 from public/js/store.js's withSample()."""

import random
import string
from datetime import date, timedelta

from sqlmodel import Session

from backend.models import Expense, Goal, Income, Installment, Subscription


def _uid() -> str:
    return "id_" + "".join(random.choices(string.ascii_lowercase + string.digits, k=10))


def apply_sample(session: Session) -> None:
    today = date.today()
    this_year = today.year
    soon = (today + timedelta(days=12)).isoformat()
    later_renewal = (today + timedelta(days=25)).isoformat()
    # 3 months before today, matching JS `new Date(year, today.getMonth() - 3, 5)`
    # rollover semantics (negative month index rolls back the year).
    month_idx = today.month - 1 - 3
    laptop_start = date(this_year + month_idx // 12, month_idx % 12 + 1, 5).isoformat()

    session.add_all([
        Income(id=_uid(), source="Junior Developer salary", amount=3800, frequency="monthly", type="net", notes="Take-home after tax"),
        Income(id=_uid(), source="Freelance / side projects", amount=450, frequency="monthly", type="net", notes=""),
    ])
    session.add_all([
        Expense(id=_uid(), name="Rent", category="Housing", amount=1200, frequency="monthly", notes="Shared apartment"),
        Expense(id=_uid(), name="Groceries", category="Food", amount=320, frequency="monthly", notes=""),
        Expense(id=_uid(), name="Utilities", category="Housing", amount=110, frequency="monthly", notes="Electric + water + internet"),
        Expense(id=_uid(), name="Transit pass", category="Transport", amount=75, frequency="monthly", notes=""),
        Expense(id=_uid(), name="Health insurance", category="Health", amount=180, frequency="monthly", notes=""),
        Expense(id=_uid(), name="Phone plan", category="Bills", amount=40, frequency="monthly", notes=""),
    ])
    session.add_all([
        Installment(id=_uid(), name="Student loan", principal=24000, monthly_payment=280, term_months=120, start_date=date(this_year, 1, 1).isoformat(), apr=4.5, notes="Federal loan"),
        Installment(id=_uid(), name="Laptop (financed)", principal=1600, monthly_payment=145, term_months=12, start_date=laptop_start, apr=0, notes="0% promo"),
    ])
    session.add_all([
        Subscription(id=_uid(), name="Spotify", amount=11, cycle="monthly", category="Entertainment", next_renewal=soon, notes=""),
        Subscription(id=_uid(), name="Gym membership", amount=35, cycle="monthly", category="Health", next_renewal=later_renewal, notes=""),
        Subscription(id=_uid(), name="Cloud storage", amount=100, cycle="annually", category="Software", next_renewal=date(this_year + 1, 3, 10).isoformat(), notes="2TB plan"),
    ])
    session.add_all([
        Goal(id=_uid(), name="Emergency fund", target=10000, saved=2400, monthly_contribution=400, deadline=date(this_year + 1, 12, 31).isoformat(), notes="3–6 months of expenses"),
        Goal(id=_uid(), name="Travel fund", target=3000, saved=600, monthly_contribution=150, deadline=None, notes=""),
    ])
