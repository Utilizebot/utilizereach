"""
Database migration runner.

Applies database/schema.sql then database/seed.sql through the shared
connection pool. Both files are idempotent, so this is safe to call on
every backend startup.

Usage:
    from database.migrate import apply_schema
    apply_schema()

    # or from the CLI:
    cd backend && python -m database.migrate
"""

import sys
from pathlib import Path

from database.pg import get_pool

SCHEMA_FILE = Path(__file__).parent / "schema.sql"
NEXUS_SCHEMA_FILE = Path(__file__).parent / "nexus_schema.sql"
SEED_FILE = Path(__file__).parent / "seed.sql"

# Advisory lock key so concurrent workers/containers don't apply the schema
# at the same time
MIGRATION_LOCK_KEY = 42


def apply_schema():
    """Run schema.sql then seed.sql inside a Postgres advisory lock."""
    pool = get_pool()
    with pool.connection() as conn:
        conn.execute("SELECT pg_advisory_lock(%s)", (MIGRATION_LOCK_KEY,))
        try:
            conn.execute(SCHEMA_FILE.read_text())
            if NEXUS_SCHEMA_FILE.exists():
                conn.execute(NEXUS_SCHEMA_FILE.read_text())
            if SEED_FILE.exists():
                conn.execute(SEED_FILE.read_text())
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (MIGRATION_LOCK_KEY,))
            conn.commit()


def main():
    try:
        apply_schema()
    except Exception as e:
        print(f"Migration failed: {e}")
        sys.exit(1)
    print("Database schema and seed data applied successfully")


if __name__ == "__main__":
    main()
