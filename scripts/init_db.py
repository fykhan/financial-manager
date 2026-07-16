"""Create all tables in Neon. Run manually: python scripts/init_db.py
No Alembic — single user, rare schema change.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv()

from backend.db import create_all  # noqa: E402

if __name__ == "__main__":
    create_all()
    print("tables created")
