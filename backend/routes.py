from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session, select

from backend.auth import require_auth
from backend.db import get_session
from backend import recurring, seed
from backend.models import Account, Expense, Goal, Income, Installment, Settings, Subscription, Transaction
from backend.schemas import (
    AccountIn,
    AccountOut,
    AccountPatch,
    ExpenseIn,
    ExpenseOut,
    ExpensePatch,
    FullData,
    GoalIn,
    GoalOut,
    GoalPatch,
    IncomeIn,
    IncomeOut,
    IncomePatch,
    InstallmentIn,
    InstallmentOut,
    InstallmentPatch,
    SettingsOut,
    SettingsPatch,
    SubscriptionIn,
    SubscriptionOut,
    SubscriptionPatch,
    TransactionIn,
    TransactionOut,
    TransactionPatch,
)

router = APIRouter(prefix="/api", tags=["data"], dependencies=[Depends(require_auth)])

# name -> (table, create/replace schema, read schema, patch schema)
COLLECTIONS = {
    "income": (Income, IncomeIn, IncomeOut, IncomePatch),
    "expenses": (Expense, ExpenseIn, ExpenseOut, ExpensePatch),
    "installments": (Installment, InstallmentIn, InstallmentOut, InstallmentPatch),
    "subscriptions": (Subscription, SubscriptionIn, SubscriptionOut, SubscriptionPatch),
    "goals": (Goal, GoalIn, GoalOut, GoalPatch),
    "accounts": (Account, AccountIn, AccountOut, AccountPatch),
    "transactions": (Transaction, TransactionIn, TransactionOut, TransactionPatch),
}


def _entry(collection: str):
    entry = COLLECTIONS.get(collection)
    if not entry:
        raise HTTPException(status_code=404, detail=f"unknown collection '{collection}'")
    return entry


def _get_settings(session: Session) -> Settings:
    return session.get(Settings, 1) or Settings(id=1)


def _snapshot(session: Session) -> FullData:
    return FullData(
        settings=SettingsOut.model_validate(_get_settings(session)),
        income=[IncomeOut.model_validate(r) for r in session.exec(select(Income)).all()],
        expenses=[ExpenseOut.model_validate(r) for r in session.exec(select(Expense)).all()],
        installments=[InstallmentOut.model_validate(r) for r in session.exec(select(Installment)).all()],
        subscriptions=[SubscriptionOut.model_validate(r) for r in session.exec(select(Subscription)).all()],
        goals=[GoalOut.model_validate(r) for r in session.exec(select(Goal)).all()],
        accounts=[AccountOut.model_validate(r) for r in session.exec(select(Account)).all()],
        transactions=[TransactionOut.model_validate(r) for r in session.exec(select(Transaction)).all()],
    )


def _wipe(session: Session) -> None:
    for Model in (Income, Expense, Installment, Subscription, Goal, Transaction, Account):
        for row in session.exec(select(Model)).all():
            session.delete(row)


@router.get("/data", response_model=FullData)
def get_data(session: Session = Depends(get_session)):
    recurring.apply_due_transactions(session)
    return _snapshot(session)


@router.post("/{collection}")
def create_record(collection: str, body: dict, session: Session = Depends(get_session)):
    Model, InSchema, OutSchema, _ = _entry(collection)
    parsed = InSchema.model_validate(body)
    # client-generated id makes this idempotent under retry: merge()
    # inserts if new, updates in place if the id already exists.
    record = session.merge(Model(**parsed.model_dump()))
    session.commit()
    session.refresh(record)
    return OutSchema.model_validate(record)


@router.patch("/{collection}/{record_id}")
def update_record(collection: str, record_id: str, body: dict, session: Session = Depends(get_session)):
    Model, _, OutSchema, PatchSchema = _entry(collection)
    record = session.get(Model, record_id)
    if not record:
        raise HTTPException(status_code=404, detail="not found")
    patch = PatchSchema.model_validate(body)
    for field, value in patch.model_dump(exclude_unset=True).items():
        setattr(record, field, value)
    session.add(record)
    session.commit()
    session.refresh(record)
    return OutSchema.model_validate(record)


@router.delete("/{collection}/{record_id}", status_code=204)
def delete_record(collection: str, record_id: str, session: Session = Depends(get_session)):
    Model, *_ = _entry(collection)
    record = session.get(Model, record_id)
    if record:
        session.delete(record)
        session.commit()
    return Response(status_code=204)


@router.patch("/settings", response_model=SettingsOut)
def update_settings(body: dict, session: Session = Depends(get_session)):
    patch = SettingsPatch.model_validate(body)
    settings = _get_settings(session)
    for field, value in patch.model_dump(exclude_unset=True).items():
        setattr(settings, field, value)
    session.add(settings)
    session.commit()
    session.refresh(settings)
    return SettingsOut.model_validate(settings)


@router.post("/data/import", response_model=FullData)
def import_data(body: dict, session: Session = Depends(get_session)):
    parsed = FullData.model_validate(body)
    _wipe(session)
    settings = _get_settings(session)
    settings.currency = parsed.settings.currency
    settings.name = parsed.settings.name
    session.add(settings)

    session.add_all(Income(**r.model_dump(exclude={"created_at"})) for r in parsed.income)
    session.add_all(Expense(**r.model_dump(exclude={"created_at"})) for r in parsed.expenses)
    session.add_all(Installment(**r.model_dump(exclude={"created_at"})) for r in parsed.installments)
    session.add_all(Subscription(**r.model_dump(exclude={"created_at"})) for r in parsed.subscriptions)
    session.add_all(Goal(**r.model_dump(exclude={"created_at"})) for r in parsed.goals)
    session.add_all(Account(**r.model_dump(exclude={"created_at"})) for r in parsed.accounts)
    session.add_all(Transaction(**r.model_dump(exclude={"created_at"})) for r in parsed.transactions)
    session.commit()
    return _snapshot(session)


@router.post("/data/sample", response_model=FullData)
def load_sample(session: Session = Depends(get_session)):
    _wipe(session)
    settings = _get_settings(session)
    settings.currency = settings.currency or "USD"
    settings.name = ""
    session.add(settings)
    seed.apply_sample(session)
    session.commit()
    return _snapshot(session)


@router.post("/data/reset", response_model=FullData)
def reset_data(session: Session = Depends(get_session)):
    _wipe(session)
    settings = _get_settings(session)
    settings.currency = "USD"
    settings.name = ""
    session.add(settings)
    session.commit()
    return _snapshot(session)
