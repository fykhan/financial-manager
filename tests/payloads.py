"""Minimal valid create-payloads for every collection in routes.COLLECTIONS.

Keyed by the same nine names store.js whitelists. Kept in one place so a new
collection only has to be added here to be picked up by the parametrized CRUD,
auth-gating and (later) tenancy tests.
"""

MINIMAL = {
    "income": {"id": "id_inc001", "source": "Job", "amount": 3000, "frequency": "monthly", "type": "net"},
    "expenses": {"id": "id_exp001", "name": "Rent", "category": "Housing", "amount": 1200, "frequency": "monthly"},
    "installments": {
        "id": "id_ins001", "name": "Laptop", "principal": 1200, "apr": 0,
        "termMonths": 6, "monthlyPayment": 200, "startDate": "2026-07-11",
    },
    "subscriptions": {
        "id": "id_sub001", "name": "Streaming", "amount": 12, "cycle": "monthly",
        "category": "Entertainment", "nextRenewal": "2026-09-15",
    },
    "savings": {"id": "id_sav001", "name": "Emergency fund", "target": 5000, "saved": 750, "monthlyContribution": 250},
    "accounts": {"id": "id_acc001", "name": "Checking", "type": "checking", "balance": 2400},
    "transactions": {
        "id": "id_txn001", "date": "2026-08-20", "description": "Groceries",
        "amount": 64.20, "type": "expense", "category": "Food",
    },
    "budgets": {"id": "id_bud001", "category": "Food", "monthlyLimit": 400},
    "debts": {"id": "id_deb001", "person": "Alex", "direction": "owed_by_me", "amount": 150},
}

# One patchable field per collection, with a value distinct from MINIMAL's.
PATCH = {
    "income": ("amount", 3500.0),
    "expenses": ("amount", 1300.0),
    "installments": ("monthlyPayment", 210.0),
    "subscriptions": ("amount", 15.0),
    "savings": ("saved", 900.0),
    "accounts": ("balance", 2600.0),
    "transactions": ("amount", 70.0),
    "budgets": ("monthlyLimit", 450.0),
    "debts": ("amount", 175.0),
}

COLLECTIONS = sorted(MINIMAL)
