"""Sample dataset, ported 1:1 from public/js/store.js's withSample()."""

import random
import string
from datetime import date, timedelta

from sqlmodel import Session

from backend.models import Account, Expense, Goal, Income, Installment, Subscription, Transaction


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

    checking_id, savings_id, wallet_id, visa_id = _uid(), _uid(), _uid(), _uid()
    session.add_all([
        Account(id=checking_id, name="Checking", type="checking", balance=1800, notes="Main spending account"),
        Account(id=savings_id, name="Savings", type="savings", balance=3200, notes=""),
        Account(id=wallet_id, name="GCash", type="wallet", balance=150, notes=""),
        Account(id=visa_id, name="Visa", type="credit", balance=340, credit_limit=2000, notes=""),
    ])

    session.add_all([
        # Auto-pay linked: posts to Checking automatically once next_date arrives.
        Income(id=_uid(), source="Junior Developer salary", amount=3800, frequency="monthly", type="net", notes="Take-home after tax",
               account_id=checking_id, next_date=(today + timedelta(days=10)).isoformat()),
        Income(id=_uid(), source="Freelance / side projects", amount=450, frequency="monthly", type="net", notes=""),
    ])
    session.add_all([
        # Auto-pay linked: posts to Checking automatically once next_date arrives.
        Expense(id=_uid(), name="Rent", category="Housing", amount=1200, frequency="monthly", notes="Shared apartment",
                account_id=checking_id, next_date=(today + timedelta(days=14)).isoformat()),
        Expense(id=_uid(), name="Groceries", category="Food", amount=320, frequency="monthly", notes=""),
        Expense(id=_uid(), name="Utilities", category="Housing", amount=110, frequency="monthly", notes="Electric + water + internet"),
        Expense(id=_uid(), name="Transit pass", category="Transport", amount=75, frequency="monthly", notes=""),
        Expense(id=_uid(), name="Health insurance", category="Health", amount=180, frequency="monthly", notes=""),
        Expense(id=_uid(), name="Phone plan", category="Bills", amount=40, frequency="monthly", notes=""),
    ])
    session.add_all([
        # Auto-pay linked: posts to Checking automatically once next_due_date arrives.
        Installment(id=_uid(), name="Student loan", principal=24000, monthly_payment=280, term_months=120, start_date=date(this_year, 1, 1).isoformat(), apr=4.5, notes="Federal loan",
                    account_id=checking_id, next_due_date=(today + timedelta(days=18)).isoformat()),
        Installment(id=_uid(), name="Laptop (financed)", principal=1600, monthly_payment=145, term_months=12, start_date=laptop_start, apr=0, notes="0% promo"),
    ])
    session.add_all([
        # Auto-pay linked: posts to Visa automatically once next_renewal arrives.
        Subscription(id=_uid(), name="Spotify", amount=11, cycle="monthly", category="Entertainment", next_renewal=soon, notes="",
                     account_id=visa_id),
        Subscription(id=_uid(), name="Gym membership", amount=35, cycle="monthly", category="Health", next_renewal=later_renewal, notes=""),
        Subscription(id=_uid(), name="Cloud storage", amount=100, cycle="annually", category="Software", next_renewal=date(this_year + 1, 3, 10).isoformat(), notes="2TB plan"),
    ])
    session.add_all([
        Goal(id=_uid(), name="Emergency fund", target=10000, saved=2400, monthly_contribution=400, deadline=date(this_year + 1, 12, 31).isoformat(), notes="3–6 months of expenses"),
        Goal(id=_uid(), name="Travel fund", target=3000, saved=600, monthly_contribution=150, deadline=None, notes=""),
    ])
    session.add_all([
        Transaction(id=_uid(), date=(today - timedelta(days=6)).isoformat(), description="Groceries", amount=64.50, type="expense", category="Food", account_id=checking_id),
        Transaction(id=_uid(), date=(today - timedelta(days=4)).isoformat(), description="Salary", amount=3800, type="income", category="Income", account_id=checking_id),
        Transaction(id=_uid(), date=(today - timedelta(days=3)).isoformat(), description="Coffee", amount=5.25, type="expense", category="Food", account_id=wallet_id),
        Transaction(id=_uid(), date=(today - timedelta(days=2)).isoformat(), description="Pay off Visa", amount=200, type="transfer", category="Transfer", account_id=checking_id, to_account_id=visa_id),
    ])
