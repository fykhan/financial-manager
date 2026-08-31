"""Server-side cascade on delete (routes.py::_cascade_delete).

store.js runs the same cascade client-side, but this one is the backstop: a
direct API call, or a client that dies halfway through its own cascade, must
not be able to leave dangling transactions or auto-pay links behind.
"""

ACCOUNT = {"id": "id_acc_a", "name": "Checking", "type": "checking", "balance": 1000}
OTHER = {"id": "id_acc_b", "name": "Savings", "type": "savings", "balance": 500}
DEBT = {"id": "id_debt_a", "person": "Alex", "direction": "owed_by_me", "amount": 200}
SAVING = {"id": "id_sav_a", "name": "Fund", "saved": 100, "monthlyContribution": 50}


def _txn(tid, **extra):
    return {"id": tid, "date": "2026-08-01", "description": "x", "amount": 10,
            "type": "expense", "category": "Other", **extra}


def test_deleting_an_account_removes_its_transactions_both_directions(client):
    client.post("/api/accounts", json=ACCOUNT)
    client.post("/api/accounts", json=OTHER)
    client.post("/api/transactions", json=_txn("id_t1", accountId="id_acc_a"))
    client.post("/api/transactions", json=_txn("id_t2", type="transfer", accountId="id_acc_b", toAccountId="id_acc_a"))
    client.post("/api/transactions", json=_txn("id_t3", accountId="id_acc_b"))

    assert client.delete("/api/accounts/id_acc_a").status_code == 204

    data = client.get("/api/data").json()
    assert [t["id"] for t in data["transactions"]] == ["id_t3"]
    assert [a["id"] for a in data["accounts"]] == ["id_acc_b"]


def test_deleting_an_account_nulls_every_auto_pay_link(client):
    client.post("/api/accounts", json=ACCOUNT)
    client.post("/api/income", json={"id": "id_i", "source": "Job", "amount": 100,
                                     "frequency": "monthly", "type": "net",
                                     "accountId": "id_acc_a", "nextDate": "2099-01-01"})
    client.post("/api/expenses", json={"id": "id_e", "name": "Rent", "category": "Housing",
                                       "amount": 100, "frequency": "monthly",
                                       "accountId": "id_acc_a", "nextDate": "2099-01-01"})
    client.post("/api/subscriptions", json={"id": "id_s", "name": "Sub", "amount": 10,
                                            "cycle": "monthly", "category": "Other",
                                            "accountId": "id_acc_a", "nextRenewal": "2099-01-01"})
    client.post("/api/installments", json={"id": "id_n", "name": "Loan", "principal": 600,
                                           "apr": 0, "termMonths": 6, "monthlyPayment": 100,
                                           "startDate": "2099-01-01",
                                           "accountId": "id_acc_a", "nextDueDate": "2099-01-01"})

    assert client.delete("/api/accounts/id_acc_a").status_code == 204

    data = client.get("/api/data").json()
    for collection in ("income", "expenses", "subscriptions", "installments"):
        assert data[collection][0]["accountId"] is None, f"{collection} kept a dangling link"


def test_deleting_a_debt_removes_its_transactions(client):
    client.post("/api/debts", json=DEBT)
    client.post("/api/transactions", json=_txn("id_t1", type="debt", debtId="id_debt_a", debtDirection="decrease"))
    client.post("/api/transactions", json=_txn("id_t2"))

    assert client.delete("/api/debts/id_debt_a").status_code == 204

    data = client.get("/api/data").json()
    assert [t["id"] for t in data["transactions"]] == ["id_t2"]
    assert data["debts"] == []


def test_deleting_a_saving_removes_its_transactions(client):
    client.post("/api/accounts", json=ACCOUNT)
    client.post("/api/savings", json=SAVING)
    client.post("/api/transactions", json=_txn("id_t1", type="savings", accountId="id_acc_a",
                                               savingId="id_sav_a", savingDirection="contribute"))
    client.post("/api/transactions", json=_txn("id_t2", accountId="id_acc_a"))

    assert client.delete("/api/savings/id_sav_a").status_code == 204

    data = client.get("/api/data").json()
    assert [t["id"] for t in data["transactions"]] == ["id_t2"]
    assert data["savings"] == []


def test_deleting_an_unrelated_record_cascades_nothing(client):
    client.post("/api/accounts", json=ACCOUNT)
    client.post("/api/transactions", json=_txn("id_t1", accountId="id_acc_a"))
    client.post("/api/budgets", json={"id": "id_b", "category": "Food", "monthlyLimit": 300})

    assert client.delete("/api/budgets/id_b").status_code == 204
    assert len(client.get("/api/data").json()["transactions"]) == 1
