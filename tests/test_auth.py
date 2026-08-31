"""Auth gating and the login throttle.

The gating test is the one that matters most long-term: it walks every route in
the data router, so a new endpoint added without require_auth fails here rather
than shipping open.
"""

import pytest

from tests.payloads import COLLECTIONS, MINIMAL
from tests.conftest import TEST_PASSWORD


def test_login_rejects_bad_password(anon):
    r = anon.post("/api/auth/login", json={"username": "tester", "password": "wrong"})
    assert r.status_code == 401


def test_login_rejects_bad_username(anon):
    r = anon.post("/api/auth/login", json={"username": "nobody", "password": TEST_PASSWORD})
    assert r.status_code == 401


def test_login_sets_cookie_and_me_succeeds(anon):
    r = anon.post("/api/auth/login", json={"username": "tester", "password": TEST_PASSWORD})
    assert r.status_code == 200
    assert "gradplan_session" in anon.cookies
    assert anon.get("/api/auth/me").status_code == 200


def test_logout_clears_the_session(client):
    assert client.get("/api/data").status_code == 200
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/data").status_code == 401


def test_data_requires_auth(anon):
    assert anon.get("/api/data").status_code == 401


@pytest.mark.parametrize("collection", COLLECTIONS)
def test_every_collection_route_requires_auth(anon, collection):
    body = MINIMAL[collection]
    assert anon.post(f"/api/{collection}", json=body).status_code == 401
    assert anon.patch(f"/api/{collection}/{body['id']}", json={}).status_code == 401
    assert anon.delete(f"/api/{collection}/{body['id']}").status_code == 401


@pytest.mark.parametrize("path", ["/api/data/import", "/api/data/sample", "/api/data/reset"])
def test_bulk_data_routes_require_auth(anon, path):
    """The destructive endpoints — these wipe every row, so an unauthenticated
    caller reaching one is the worst case in the whole API."""
    assert anon.post(path, json={}).status_code == 401


def test_settings_requires_auth(anon):
    assert anon.patch("/api/settings", json={"currency": "EUR"}).status_code == 401


def test_garbage_cookie_is_rejected(anon):
    anon.cookies.set("gradplan_session", "not-a-jwt")
    assert anon.get("/api/data").status_code == 401


def test_throttle_blocks_after_repeated_failures(anon):
    """10 failures in 15 minutes per IP, per backend/auth.py's THROTTLE_MAX_FAILURES."""
    for _ in range(10):
        assert anon.post("/api/auth/login", json={"username": "tester", "password": "wrong"}).status_code == 401
    r = anon.post("/api/auth/login", json={"username": "tester", "password": "wrong"})
    assert r.status_code == 429
    # A correct password does not bypass the throttle.
    r = anon.post("/api/auth/login", json={"username": "tester", "password": TEST_PASSWORD})
    assert r.status_code == 429
