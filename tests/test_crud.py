"""Generic per-collection CRUD, driven off the same registry routes.py uses.

Every assertion here is about the contract store.js depends on: a create is
idempotent under retry, a patch is partial, a delete is a no-op the second
time, and whatever comes back is what GET /api/data will show.
"""

import pytest

from tests.payloads import COLLECTIONS, MINIMAL, PATCH


def _snapshot(client):
    r = client.get("/api/data")
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize("collection", COLLECTIONS)
def test_create_then_read_then_patch_then_delete(client, collection):
    body = MINIMAL[collection]
    rid = body["id"]

    created = client.post(f"/api/{collection}", json=body)
    assert created.status_code == 200, created.text
    assert created.json()["id"] == rid

    rows = _snapshot(client)[collection]
    assert [r["id"] for r in rows] == [rid]

    field, value = PATCH[collection]
    patched = client.patch(f"/api/{collection}/{rid}", json={field: value})
    assert patched.status_code == 200, patched.text
    assert patched.json()[field] == value
    assert _snapshot(client)[collection][0][field] == value

    assert client.delete(f"/api/{collection}/{rid}").status_code == 204
    assert _snapshot(client)[collection] == []


@pytest.mark.parametrize("collection", COLLECTIONS)
def test_create_is_idempotent_under_retry(client, collection):
    """POST uses session.merge() precisely so a retried create updates in place
    instead of 409-ing on the client-generated id. A duplicated row here would
    mean silent double-counting in every total on the dashboard."""
    body = MINIMAL[collection]
    assert client.post(f"/api/{collection}", json=body).status_code == 200
    assert client.post(f"/api/{collection}", json=body).status_code == 200
    assert len(_snapshot(client)[collection]) == 1


@pytest.mark.parametrize("collection", COLLECTIONS)
def test_delete_is_idempotent(client, collection):
    body = MINIMAL[collection]
    client.post(f"/api/{collection}", json=body)
    assert client.delete(f"/api/{collection}/{body['id']}").status_code == 204
    assert client.delete(f"/api/{collection}/{body['id']}").status_code == 204


@pytest.mark.parametrize("collection", COLLECTIONS)
def test_patch_unknown_id_is_404(client, collection):
    assert client.patch(f"/api/{collection}/id_nope", json={}).status_code == 404


def test_unknown_collection_is_404(client):
    assert client.post("/api/not_a_collection", json={"id": "x"}).status_code == 404
    assert client.patch("/api/not_a_collection/x", json={}).status_code == 404
    assert client.delete("/api/not_a_collection/x").status_code == 404


def test_patch_is_partial_and_leaves_other_fields_alone(client):
    client.post("/api/expenses", json=MINIMAL["expenses"])
    client.patch("/api/expenses/id_exp001", json={"amount": 1500})
    row = _snapshot(client)["expenses"][0]
    assert row["amount"] == 1500
    assert row["name"] == "Rent" and row["category"] == "Housing"


@pytest.mark.parametrize(
    "collection,body",
    [
        ("income", {**MINIMAL["income"], "frequency": "fortnightly"}),
        ("accounts", {**MINIMAL["accounts"], "type": "brokerage"}),
        ("transactions", {**MINIMAL["transactions"], "type": "refund"}),
        ("debts", {**MINIMAL["debts"], "direction": "sideways"}),
    ],
)
def test_values_outside_the_vocabulary_are_rejected(client, collection, body):
    """schemas.py constrains these to Literals because an out-of-vocabulary
    value used to save fine and then vanish from every calc.js total."""
    assert client.post(f"/api/{collection}", json=body).status_code == 422


def test_missing_required_field_is_rejected(client):
    assert client.post("/api/expenses", json={"id": "id_x", "name": "No amount"}).status_code == 422


@pytest.mark.parametrize(
    "collection,field",
    [
        ("installments", "monthlyPayment"),
        ("installments", "startDate"),
        ("subscriptions", "nextRenewal"),
        ("savings", "deadline"),
        ("expenses", "nextDate"),
        ("transactions", "accountId"),
    ],
)
def test_blank_strings_coerce_to_null(client, collection, field):
    """forms.js's getValues() sends untouched number/date inputs as '', not
    null — the field_validators in schemas.py exist to absorb that."""
    body = {**MINIMAL[collection], field: ""}
    r = client.post(f"/api/{collection}", json=body)
    assert r.status_code == 200, r.text
    assert r.json()[field] is None


def test_settings_patch_round_trips(client):
    r = client.patch("/api/settings", json={"currency": "EUR", "name": "Farhan"})
    assert r.status_code == 200
    assert r.json() == {"currency": "EUR", "name": "Farhan"}
    assert _snapshot(client)["settings"]["currency"] == "EUR"
