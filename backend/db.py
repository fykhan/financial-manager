"""SQLAlchemy engine + session dependency, pointed at Neon's pooled connection."""

import os

from sqlalchemy.pool import NullPool
from sqlmodel import Session, SQLModel, create_engine


def _resolve_url() -> str:
    url = os.environ["DATABASE_URL"]
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


# Neon's pooled endpoint already pools via PgBouncer, so we don't pool again here,
# and pool_pre_ping avoids handing out connections that went stale while the
# free-tier project scaled to zero.
engine = create_engine(_resolve_url(), poolclass=NullPool, pool_pre_ping=True)


def get_session():
    with Session(engine) as session:
        yield session


def create_all():
    import backend.models  # noqa: F401  registers tables on SQLModel.metadata

    SQLModel.metadata.create_all(engine)
