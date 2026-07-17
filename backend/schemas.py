"""Pydantic I/O models. DB columns are snake_case; JSON stays camelCase (what
calc.js/views.js/forms.js already expect) via alias_generator=to_camel.
populate_by_name=True lets code inside this module still construct instances
with snake_case kwargs.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


def _blank_to_none(v):
    return None if v == "" else v


# ---- settings ----

class SettingsOut(CamelModel):
    currency: str
    name: str


class SettingsPatch(CamelModel):
    currency: str | None = None
    name: str | None = None


# ---- income ----

class IncomeIn(CamelModel):
    id: str
    source: str
    amount: float
    frequency: str
    type: str = "net"
    notes: str = ""
    account_id: str | None = None
    next_date: str | None = None

    _blank_auto_pay = field_validator("account_id", "next_date", mode="before")(_blank_to_none)


class IncomeOut(IncomeIn):
    created_at: datetime


class IncomePatch(CamelModel):
    source: str | None = None
    amount: float | None = None
    frequency: str | None = None
    type: str | None = None
    notes: str | None = None
    account_id: str | None = None
    next_date: str | None = None

    _blank_auto_pay = field_validator("account_id", "next_date", mode="before")(_blank_to_none)


# ---- expenses ----

class ExpenseIn(CamelModel):
    id: str
    name: str
    category: str
    amount: float
    frequency: str
    notes: str = ""
    account_id: str | None = None
    next_date: str | None = None

    _blank_auto_pay = field_validator("account_id", "next_date", mode="before")(_blank_to_none)


class ExpenseOut(ExpenseIn):
    created_at: datetime


class ExpensePatch(CamelModel):
    name: str | None = None
    category: str | None = None
    amount: float | None = None
    frequency: str | None = None
    notes: str | None = None
    account_id: str | None = None
    next_date: str | None = None

    _blank_auto_pay = field_validator("account_id", "next_date", mode="before")(_blank_to_none)


# ---- installments ----

class InstallmentIn(CamelModel):
    id: str
    name: str
    principal: float
    apr: float = 0
    term_months: int
    monthly_payment: float | None = None
    start_date: str | None = None
    notes: str = ""
    account_id: str | None = None
    next_due_date: str | None = None

    _blank_payment = field_validator(
        "monthly_payment", "start_date", "account_id", "next_due_date", mode="before",
    )(_blank_to_none)


class InstallmentOut(InstallmentIn):
    created_at: datetime


class InstallmentPatch(CamelModel):
    name: str | None = None
    principal: float | None = None
    apr: float | None = None
    term_months: int | None = None
    monthly_payment: float | None = None
    start_date: str | None = None
    notes: str | None = None
    account_id: str | None = None
    next_due_date: str | None = None

    _blank_payment = field_validator(
        "monthly_payment", "start_date", "account_id", "next_due_date", mode="before",
    )(_blank_to_none)


# ---- subscriptions ----

class SubscriptionIn(CamelModel):
    id: str
    name: str
    amount: float
    cycle: str
    category: str = "Other"
    next_renewal: str | None = None
    notes: str = ""
    account_id: str | None = None

    _blank_renewal = field_validator("next_renewal", "account_id", mode="before")(_blank_to_none)


class SubscriptionOut(SubscriptionIn):
    created_at: datetime


class SubscriptionPatch(CamelModel):
    name: str | None = None
    amount: float | None = None
    cycle: str | None = None
    category: str | None = None
    next_renewal: str | None = None
    notes: str | None = None
    account_id: str | None = None

    _blank_renewal = field_validator("next_renewal", "account_id", mode="before")(_blank_to_none)


# ---- goals ----

class GoalIn(CamelModel):
    id: str
    name: str
    target: float
    saved: float = 0
    monthly_contribution: float = 0
    deadline: str | None = None
    notes: str = ""

    _blank_deadline = field_validator("deadline", mode="before")(_blank_to_none)


class GoalOut(GoalIn):
    created_at: datetime


class GoalPatch(CamelModel):
    name: str | None = None
    target: float | None = None
    saved: float | None = None
    monthly_contribution: float | None = None
    deadline: str | None = None
    notes: str | None = None

    _blank_deadline = field_validator("deadline", mode="before")(_blank_to_none)


# ---- budgets ----

class BudgetIn(CamelModel):
    id: str
    category: str
    monthly_limit: float
    notes: str = ""


class BudgetOut(BudgetIn):
    created_at: datetime


class BudgetPatch(CamelModel):
    category: str | None = None
    monthly_limit: float | None = None
    notes: str | None = None


# ---- accounts ----

class AccountIn(CamelModel):
    id: str
    name: str
    type: str
    balance: float = 0
    credit_limit: float | None = None
    notes: str = ""

    _blank_limit = field_validator("credit_limit", mode="before")(_blank_to_none)


class AccountOut(AccountIn):
    created_at: datetime


class AccountPatch(CamelModel):
    name: str | None = None
    type: str | None = None
    balance: float | None = None
    credit_limit: float | None = None
    notes: str | None = None

    _blank_limit = field_validator("credit_limit", mode="before")(_blank_to_none)


# ---- debts ----

class DebtIn(CamelModel):
    id: str
    person: str
    direction: str
    amount: float
    notes: str = ""


class DebtOut(DebtIn):
    created_at: datetime


class DebtPatch(CamelModel):
    person: str | None = None
    direction: str | None = None
    amount: float | None = None
    notes: str | None = None


# ---- transactions ----

class TransactionIn(CamelModel):
    id: str
    date: str
    description: str
    amount: float
    type: str
    category: str = "Other"
    account_id: str | None = None
    to_account_id: str | None = None
    debt_id: str | None = None
    debt_direction: str | None = None
    notes: str = ""

    _blank_accounts = field_validator(
        "account_id", "to_account_id", "debt_id", "debt_direction", mode="before",
    )(_blank_to_none)


class TransactionOut(TransactionIn):
    created_at: datetime


class TransactionPatch(CamelModel):
    date: str | None = None
    description: str | None = None
    amount: float | None = None
    type: str | None = None
    category: str | None = None
    account_id: str | None = None
    to_account_id: str | None = None
    debt_id: str | None = None
    debt_direction: str | None = None
    notes: str | None = None

    _blank_accounts = field_validator(
        "account_id", "to_account_id", "debt_id", "debt_direction", mode="before",
    )(_blank_to_none)


class FullData(CamelModel):
    version: int = 1
    settings: SettingsOut = Field(default_factory=lambda: SettingsOut(currency="USD", name=""))
    income: list[IncomeOut] = Field(default_factory=list)
    expenses: list[ExpenseOut] = Field(default_factory=list)
    installments: list[InstallmentOut] = Field(default_factory=list)
    subscriptions: list[SubscriptionOut] = Field(default_factory=list)
    goals: list[GoalOut] = Field(default_factory=list)
    accounts: list[AccountOut] = Field(default_factory=list)
    transactions: list[TransactionOut] = Field(default_factory=list)
    budgets: list[BudgetOut] = Field(default_factory=list)
    debts: list[DebtOut] = Field(default_factory=list)
