"""SQLModel tables. Columns are snake_case; API-facing camelCase conversion
happens in schemas.py so calc.js/views.js on the frontend need zero changes.

`id` on the five collection tables is a client-generated string (store.js's
uid(), 'id_' + base36) kept as-is for idempotent writes — not a DB sequence.
"""

from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Settings(SQLModel, table=True):
    __tablename__ = "settings"

    id: int = Field(default=1, primary_key=True)
    currency: str = Field(default="USD")
    name: str = Field(default="")


class Income(SQLModel, table=True):
    __tablename__ = "income"

    id: str = Field(primary_key=True)
    source: str
    amount: float
    frequency: str
    type: str = Field(default="net")
    notes: str = Field(default="")
    created_at: datetime = Field(default_factory=_now)


class Expense(SQLModel, table=True):
    __tablename__ = "expenses"

    id: str = Field(primary_key=True)
    name: str
    category: str
    amount: float
    frequency: str
    notes: str = Field(default="")
    created_at: datetime = Field(default_factory=_now)


class Installment(SQLModel, table=True):
    __tablename__ = "installments"

    id: str = Field(primary_key=True)
    name: str
    principal: float
    apr: float = Field(default=0)
    term_months: int
    monthly_payment: float | None = Field(default=None)
    start_date: str | None = Field(default=None)
    notes: str = Field(default="")
    created_at: datetime = Field(default_factory=_now)


class Subscription(SQLModel, table=True):
    __tablename__ = "subscriptions"

    id: str = Field(primary_key=True)
    name: str
    amount: float
    cycle: str
    category: str = Field(default="Other")
    next_renewal: str | None = Field(default=None)
    notes: str = Field(default="")
    created_at: datetime = Field(default_factory=_now)


class Goal(SQLModel, table=True):
    __tablename__ = "goals"

    id: str = Field(primary_key=True)
    name: str
    target: float
    saved: float = Field(default=0)
    monthly_contribution: float = Field(default=0)
    deadline: str | None = Field(default=None)
    notes: str = Field(default="")
    created_at: datetime = Field(default_factory=_now)


class Account(SQLModel, table=True):
    __tablename__ = "accounts"

    id: str = Field(primary_key=True)
    name: str
    type: str
    balance: float = Field(default=0)
    credit_limit: float | None = Field(default=None)
    notes: str = Field(default="")
    created_at: datetime = Field(default_factory=_now)


class Transaction(SQLModel, table=True):
    __tablename__ = "transactions"

    id: str = Field(primary_key=True)
    date: str
    description: str
    amount: float
    type: str
    category: str = Field(default="Other")
    account_id: str | None = Field(default=None)
    to_account_id: str | None = Field(default=None)
    notes: str = Field(default="")
    created_at: datetime = Field(default_factory=_now)


class LoginAttempt(SQLModel, table=True):
    __tablename__ = "login_attempts"

    id: int | None = Field(default=None, primary_key=True)
    ip: str = Field(index=True)
    at: datetime = Field(default_factory=_now)
    success: bool
