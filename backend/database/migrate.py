"""
Database migration runner.

Applies, in order, on the schema OWNER connection (DATABASE_URL):
    schema.sql -> nexus_schema.sql -> seed.sql -> multibrand.sql
All files are idempotent, so this is safe to call on every backend startup.

The owner connection runs with tenancy bypassed and brand 1 bound, so legacy
seed inserts land on the default brand once brand_id exists.

After the SQL, two Python steps:
  * seed brand 1's branding from the deployment's existing config.json the
    first time (so the default brand keeps its current name/colors/copy), and
  * when APP_DB_PASSWORD is set, give the least-privilege app_rw role LOGIN
    with that password (the app then connects via APP_DATABASE_URL).

Usage:
    from database.migrate import apply_schema
    apply_schema()

    # or from the CLI:
    cd backend && python -m database.migrate
"""

import json
import os
import sys
from pathlib import Path

import psycopg
from psycopg import sql as pgsql
from psycopg.types.json import Jsonb

from database.pg import get_owner_database_url
from database.tenancy import DEFAULT_BRAND_ID

SCHEMA_FILE = Path(__file__).parent / "schema.sql"
NEXUS_SCHEMA_FILE = Path(__file__).parent / "nexus_schema.sql"
SEED_FILE = Path(__file__).parent / "seed.sql"
MULTIBRAND_FILE = Path(__file__).parent / "multibrand.sql"

# Existing deployment config (served to the frontend) used to seed brand 1.
SHARED_CONFIG_CANDIDATES = [
    Path("/app/shared_config/config.json"),
    Path(__file__).resolve().parents[2] / "public" / "config.json",
]

# Advisory lock key so concurrent workers/containers don't apply the schema
# at the same time
MIGRATION_LOCK_KEY = 42


def _load_shared_config() -> dict:
    for p in SHARED_CONFIG_CANDIDATES:
        try:
            if p.exists():
                return json.loads(p.read_text())
        except (OSError, ValueError):
            continue
    return {}


def _seed_default_brand_branding(conn) -> None:
    """Copy the deployment's config.json into brand 1 the first time only."""
    row = conn.execute(
        "SELECT branding FROM brands WHERE id = %s", (DEFAULT_BRAND_ID,)
    ).fetchone()
    if not row or row[0]:
        return
    cfg = _load_shared_config()
    if not cfg:
        return
    # NOT "branding" (colors): config.json's color fields are dead today - the
    # live palette is compiled into the frontend - and the runtime theme reads
    # brands.branding.branding.primaryColor, so copying them would recolor
    # brand 1. A brand's colors are only ever set explicitly in the UI.
    branding = {k: cfg[k] for k in ("company", "form", "dashboard", "features", "emailTeam") if k in cfg}
    name = (cfg.get("company") or {}).get("name") or None
    conn.execute(
        "UPDATE brands SET branding = %s, display_name = COALESCE(%s, display_name), updated_at = NOW() WHERE id = %s",
        (Jsonb(branding), name, DEFAULT_BRAND_ID),
    )


def _enable_app_role(conn) -> None:
    password = os.getenv("APP_DB_PASSWORD", "").strip()
    if not password:
        return
    # ALTER ROLE cannot take bind parameters; quote the literal safely.
    lit = pgsql.Literal(password).as_string(conn)
    conn.execute(f"ALTER ROLE app_rw WITH LOGIN PASSWORD {lit}")


def apply_schema():
    """Run the schema files, then the multi-brand migration, inside an advisory lock."""
    with psycopg.connect(get_owner_database_url()) as conn:
        conn.execute("SELECT pg_advisory_lock(%s)", (MIGRATION_LOCK_KEY,))
        try:
            # Session-level (not LOCAL): the seed inserts below rely on the
            # brand_id column default once it exists.
            conn.execute("SELECT set_config('app.tenancy_bypass', 'on', false)")
            conn.execute("SELECT set_config('app.brand_id', %s, false)", (DEFAULT_BRAND_ID,))
            conn.execute(SCHEMA_FILE.read_text())
            if NEXUS_SCHEMA_FILE.exists():
                conn.execute(NEXUS_SCHEMA_FILE.read_text())
            if SEED_FILE.exists():
                conn.execute(SEED_FILE.read_text())
            conn.execute(MULTIBRAND_FILE.read_text())
            _seed_default_brand_branding(conn)
            _enable_app_role(conn)
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
