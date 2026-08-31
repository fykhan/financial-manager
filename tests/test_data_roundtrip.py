"""Export -> import -> export parity, plus the destructive bulk endpoints.

This is the regression oracle for any future change to the data layer (the
multi-user migration above all): whatever else changes, a snapshot fed back
through /api/data/import must come out the other side unchanged.
"""

from tests.payloads import COLLECTIONS, MINIMAL

# import_data rebuilds rows with model_dump(exclude={"created_at"}), so the
# server stamps a fresh timestamp — identity is defined by everything else.
VOLATILE = {"createdAt"}


def _comparable(snapshot):
    """Order-insensitive, timestamp-insensitive view of a snapshot.

    _snapshot() issues plain select()s with no ORDER BY, so row order is
    whatever the database feels like returning and is not part of the contract.
    """
    out = {"settings": snapshot["settings"]}
    for name in COLLECTIONS:
        out[name] = sorted(
            ({k: v for k, v in row.items() if k not in VOLATILE} for row in snapshot[name]),
            key=lambda r: r["id"],
        )
    return out


def _seed_one_of_everything(client):
    for name in COLLECTIONS:
        assert client.post(f"/api/{name}", json=MINIMAL[name]).status_code == 200
    client.patch("/api/settings", json={"currency": "GBP", "name": "Farhan"})


def test_export_import_export_is_stable(client):
    _seed_one_of_everything(client)
    first = client.get("/api/data").json()

    imported = client.post("/api/data/import", json=first)
    assert imported.status_code == 200, imported.text

    second = client.get("/api/data").json()
    assert _comparable(second) == _comparable(first)
    # and the endpoint's own return value already reflects the new state
    assert _comparable(imported.json()) == _comparable(first)


def test_import_replaces_rather_than_merges(client):
    _seed_one_of_everything(client)
    empty = {"version": 1, "settings": {"currency": "USD", "name": ""}}
    assert client.post("/api/data/import", json=empty).status_code == 200

    after = client.get("/api/data").json()
    for name in COLLECTIONS:
        assert after[name] == [], f"{name} survived a replacing import"


def test_invalid_import_is_rejected_without_touching_existing_data(client):
    """import_data validates before _wipe(). If that order ever flips, a
    malformed upload becomes a data-loss event."""
    _seed_one_of_everything(client)
    before = client.get("/api/data").json()

    bad = {"version": 1, "settings": {"currency": "USD", "name": ""},
           "accounts": [{"id": "id_bad", "name": "Nope", "type": "brokerage"}]}
    assert client.post("/api/data/import", json=bad).status_code == 422

    assert _comparable(client.get("/api/data").json()) == _comparable(before)


def test_sample_populates_and_reset_clears(client):
    sample = client.post("/api/data/sample", json={})
    assert sample.status_code == 200
    body = sample.json()
    assert body["income"] and body["expenses"] and body["accounts"], "sample data looks empty"

    reset = client.post("/api/data/reset", json={})
    assert reset.status_code == 200
    for name in COLLECTIONS:
        assert reset.json()[name] == []
    assert reset.json()["settings"] == {"currency": "USD", "name": ""}


def test_sample_data_survives_its_own_export_import(client):
    """The seed set is the widest realistic payload we have — it exercises
    cross-references (auto-pay links, transactions pointing at accounts) that
    the one-row-per-collection fixtures don't."""
    client.post("/api/data/sample", json={})
    first = client.get("/api/data").json()
    assert client.post("/api/data/import", json=first).status_code == 200
    assert _comparable(client.get("/api/data").json()) == _comparable(first)
