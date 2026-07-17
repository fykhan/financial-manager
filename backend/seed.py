"""Sample dataset, ported 1:1 from public/js/store.js's withSample()."""

import random
import string
from datetime import date, timedelta

from sqlmodel import Session

from backend.models import Account, Budget, Debt, Expense, Income, Installment, Saving, Subscription, Transaction


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
        Expense(id=_uid(), name="Utilities", category="Housing", amount=110, frequency="monthly", notes="Electric + water + internet"),
        Expense(id=_uid(), name="Health insurance", category="Health", amount=180, frequency="monthly", notes=""),
        Expense(id=_uid(), name="Phone plan", category="Bills", amount=40, frequency="monthly", notes=""),
        # Food and Transport are variable, not fixed — they're tracked via the
        # Food/Transport Budgets below plus actual Transactions, not a fixed
        # Expense row (see spendingByCategory in calc.js).
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
    emergency_saving_id, travel_saving_id = _uid(), _uid()
    session.add_all([
        Saving(id=emergency_saving_id, name="Emergency fund", target=10000, saved=2400, monthly_contribution=400, deadline=date(this_year + 1, 12, 31).isoformat(), notes="3–6 months of expenses"),
        Saving(id=travel_saving_id, name="Travel fund", target=3000, saved=600, monthly_contribution=150, deadline=None, notes=""),
    ])
    session.add_all([
        Budget(id=_uid(), category="Housing", monthly_limit=1300, notes=""),
        Budget(id=_uid(), category="Food", monthly_limit=280, notes=""),
        Budget(id=_uid(), category="Transport", monthly_limit=110, notes=""),
        Budget(id=_uid(), category="Bills", monthly_limit=45, notes=""),
        Budget(id=_uid(), category="Entertainment", monthly_limit=5, notes=""),
    ])
    john_debt_id, sarah_debt_id = _uid(), _uid()
    session.add_all([
        Debt(id=john_debt_id, person="John", direction="owed_to_me", amount=120, notes="Concert tickets"),
        Debt(id=sarah_debt_id, person="Sarah", direction="owed_by_me", amount=50, notes="Borrowed for groceries"),
    ])
    session.add_all([
        Transaction(id=_uid(), date=(today - timedelta(days=6)).isoformat(), description="Groceries", amount=64.50, type="expense", category="Food", account_id=checking_id),
        Transaction(id=_uid(), date=(today - timedelta(days=4)).isoformat(), description="Salary", amount=3800, type="income", category="Income", account_id=checking_id),
        Transaction(id=_uid(), date=(today - timedelta(days=3)).isoformat(), description="Coffee", amount=5.25, type="expense", category="Food", account_id=wallet_id),
        Transaction(id=_uid(), date=(today - timedelta(days=5)).isoformat(), description="Bus pass top-up", amount=40, type="expense", category="Transport", account_id=checking_id),
        Transaction(id=_uid(), date=(today - timedelta(days=2)).isoformat(), description="Ride share", amount=18, type="expense", category="Transport", account_id=wallet_id),
        Transaction(id=_uid(), date=(today - timedelta(days=2)).isoformat(), description="Pay off Visa", amount=200, type="transfer", category="Transfer", account_id=checking_id, to_account_id=visa_id),
        Transaction(id=_uid(), date=(today - timedelta(days=1)).isoformat(), description="John paid back $30", amount=30, type="debt", category="Debt", debt_id=john_debt_id, debt_direction="decrease"),
        Transaction(id=_uid(), date=(today - timedelta(days=7)).isoformat(), description="Move to Emergency fund", amount=200, type="savings", category="Savings", account_id=checking_id, saving_id=emergency_saving_id, saving_direction="contribute"),
    ])
