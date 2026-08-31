"""Backend test fixtures.

Safety note, and the reason the env setup happens before any project import:
app.py calls load_dotenv() at module scope, and python-dotenv does NOT override
variables that are already set. Pinning DATABASE_URL here therefore guarantees
the suite talks to a throwaway in-memory SQLite database even though a real
.env pointing at production Neon sits in the repo root. Overriding get_session
below is the second layer — nothing in these tests can reach Neon.

SQLite is a stand-in, not the deployment target: it's fast and disposable, and
every column in backend/models.py is a plain str/float/int/bool/datetime, so
the schema maps cleanly. Anything Postgres-specific (row locking, RLS) needs a
run against a real Neon branch instead.
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)  # app.py mounts StaticFiles(directory="public") at import time

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["AUTH_USERNAME"] = "tester"
os.environ["JWT_SECRET"] = "test-secret-not-a-real-key-padded-to-32-bytes"
os.environ.pop("VERCEL", None)  # keeps cookies non-Secure so TestClient's http:// works

import pytest  # noqa: E402
from argon2 import PasswordHasher  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from sqlmodel import Session, SQLModel, create_engine  # noqa: E402

TEST_PASSWORD = "correct-horse-battery-staple"
os.environ["AUTH_PASSWORD_HASH"] = PasswordHasher().hash(TEST_PASSWORD)

import backend.models  # noqa: E402,F401  registers tables on SQLModel.metadata
from app import app  # noqa: E402
from backend.db import get_session  # noqa: E402


@pytest.fixture
def engine():
    # StaticPool keeps every connection pointed at the same in-memory database;
    # the default pool would hand out a fresh (empty) one per connection.
    eng = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def session(engine):
    """Direct DB access, for asserting on state the API doesn't expose."""
    with Session(engine) as s:
        yield s


@pytest.fixture
def anon(engine):
    """Client with no session cookie."""
    def _override():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_session] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def client(anon):
    """Logged-in client. TestClient persists the session cookie across requests."""
    r = anon.post(
        "/api/auth/login", json={"username": "tester", "password": TEST_PASSWORD}
    )
    assert r.status_code == 200, r.text
    return anon
