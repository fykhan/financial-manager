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


class IncomeOut(IncomeIn):
    created_at: datetime


class IncomePatch(CamelModel):
    source: str | None = None
    amount: float | None = None
    frequency: str | None = None
    type: str | None = None
    notes: str | None = None


# ---- expenses ----

class ExpenseIn(CamelModel):
    id: str
    name: str
    category: str
    amount: float
    frequency: str
    notes: str = ""


class ExpenseOut(ExpenseIn):
    created_at: datetime


class ExpensePatch(CamelModel):
    name: str | None = None
    category: str | None = None
    amount: float | None = None
    frequency: str | None = None
    notes: str | None = None


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

    _blank_payment = field_validator("monthly_payment", "start_date", mode="before")(_blank_to_none)


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

    _blank_payment = field_validator("monthly_payment", "start_date", mode="before")(_blank_to_none)


# ---- subscriptions ----

class SubscriptionIn(CamelModel):
    id: str
    name: str
    amount: float
    cycle: str
    category: str = "Other"
    next_renewal: str | None = None
    notes: str = ""

    _blank_renewal = field_validator("next_renewal", mode="before")(_blank_to_none)


class SubscriptionOut(SubscriptionIn):
    created_at: datetime


class SubscriptionPatch(CamelModel):
    name: str | None = None
    amount: float | None = None
    cycle: str | None = None
    category: str | None = None
    next_renewal: str | None = None
    notes: str | None = None

    _blank_renewal = field_validator("next_renewal", mode="before")(_blank_to_none)


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


class FullData(CamelModel):
    version: int = 1
    settings: SettingsOut = Field(default_factory=lambda: SettingsOut(currency="USD", name=""))
    income: list[IncomeOut] = Field(default_factory=list)
    expenses: list[ExpenseOut] = Field(default_factory=list)
    installments: list[InstallmentOut] = Field(default_factory=list)
    subscriptions: list[SubscriptionOut] = Field(default_factory=list)
    goals: list[GoalOut] = Field(default_factory=list)
