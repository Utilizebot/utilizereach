"""
Brand (tenant) context for code that runs OUTSIDE an HTTP request:
Celery tasks, beat jobs and standalone scripts.

Inside an authenticated request the active brand is already bound by
api/dependencies.get_current_user. Everywhere else it must be set
deliberately (see docs/MULTIBRAND.md):

    # Celery task
    bid = task_brand_id(brand_id, "scrape_leads", lookup=("scraping_jobs", job_id))
    with brand_scope(bid):
        ...

    # standalone script (BRAND_ID env = brand id or slug, default brand 1)
    with script_brand_scope() as brand_id:
        main()

    # the brand's sending mailbox (brand 1: backend/.gmail_tokens when present)
    creds = brand_gmail_credentials()
"""

from __future__ import annotations

import os
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, Iterator, Optional, Tuple

from database import tenancy
from database.tenancy import DEFAULT_BRAND_ID, TenancyError, brand_scope, system_scope

BACKEND_DIR = Path(__file__).resolve().parent.parent
LEGACY_GMAIL_TOKENS_FILE = BACKEND_DIR / ".gmail_tokens"


def _warn(msg: str) -> None:
    print(f"[tenancy] WARNING: {msg}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# Brand resolution
# ---------------------------------------------------------------------------

def resolve_brand(ref: str) -> dict:
    """Brand row by id or slug; raises TenancyError when unknown."""
    from database import brands as brand_catalog

    brand = brand_catalog.get_brand(ref)
    if not brand:
        raise TenancyError(f"Unknown brand {ref!r}")
    return brand


def is_default_brand(brand_id: Optional[str]) -> bool:
    return str(brand_id or "") == DEFAULT_BRAND_ID


def task_brand_id(
    brand_id: Optional[str],
    task_name: str,
    lookup: Optional[Tuple[str, str]] = None,
) -> str:
    """The brand a Celery task must run as.

    * brand_id given (every new caller passes tenancy.require_brand()):
      validated against the brand catalog and returned.
    * brand_id missing (a message queued before the multi-brand release):
      when `lookup=(table, row_id)` names the row the task works on, the
      brand that OWNS that row is used (looked up in system_scope, only the
      brand id is read); otherwise brand 1. Either way a warning is logged.
    """
    if brand_id:
        return resolve_brand(str(brand_id))["id"]

    if lookup and lookup[1]:
        table, row_id = lookup
        if table not in tenancy.TENANT_TABLES:
            raise ValueError(f"task_brand_id lookup needs a tenant table, got {table!r}")
        try:
            from database.pg import execute_sql

            with system_scope():
                rows = execute_sql(f'SELECT brand_id FROM "{table}" WHERE id = %s', [row_id])
            if rows and rows[0].get("brand_id"):
                _warn(f"{task_name}: message has no brand_id (queued before multi-brand); "
                      f"using the owner of {table}/{row_id}: {rows[0]['brand_id']}")
                return str(rows[0]["brand_id"])
        except Exception as e:  # pragma: no cover - defensive
            _warn(f"{task_name}: brand lookup on {table}/{row_id} failed: {e}")

    _warn(f"{task_name}: message has no brand_id (queued before multi-brand); "
          f"defaulting to brand 1 ({DEFAULT_BRAND_ID})")
    return DEFAULT_BRAND_ID


def brand_id_from_env(var: str = "BRAND_ID") -> str:
    """Brand for a standalone script: $BRAND_ID (id or slug), default brand 1."""
    ref = (os.getenv(var) or "").strip()
    if not ref:
        _warn(f"{var} not set - running as brand 1 ({DEFAULT_BRAND_ID})")
        return DEFAULT_BRAND_ID
    brand = resolve_brand(ref)
    if not brand.get("is_active"):
        raise TenancyError(f"Brand {brand['slug']!r} is inactive")
    return brand["id"]


@contextmanager
def script_brand_scope(var: str = "BRAND_ID", legacy_mailbox: bool = False) -> Iterator[str]:
    """Run a standalone script's DB work as the brand named by $BRAND_ID.

    legacy_mailbox=True marks an old script that sends through
    backend/.gmail_tokens (brand 1's mailbox): it may only run as brand 1,
    otherwise another brand's records would be sent from brand 1's mailbox.
    """
    brand_id = brand_id_from_env(var)
    if legacy_mailbox and not is_default_brand(brand_id):
        raise SystemExit(
            f"This script sends through backend/.gmail_tokens (brand 1's mailbox) and only "
            f"supports brand 1; {var}={os.getenv(var)!r} is another brand. "
            f"Use run_campaign.py or the sender for other brands."
        )
    print(f"[tenancy] running as brand {brand_id}", flush=True)
    with brand_scope(brand_id):
        yield brand_id


@contextmanager
def ensure_brand_scope(brand_id: Optional[str] = None) -> Iterator[str]:
    """Enter `brand_id` if given, else keep the active brand.

    Refuses to switch to a DIFFERENT brand from inside another brand's scope
    (that would be a cross-brand read); system scope may name any brand.
    """
    active = tenancy.current_brand()
    if brand_id:
        brand_id = str(brand_id)
        if active and active != brand_id and not tenancy.in_system_scope():
            raise TenancyError(f"Refusing to act as brand {brand_id} while acting as {active}")
        if active == brand_id and not tenancy.in_system_scope():
            yield brand_id
            return
        with brand_scope(brand_id):
            yield brand_id
        return
    if not active:
        raise TenancyError("No active brand for this operation")
    yield active


# ---------------------------------------------------------------------------
# Per-brand Gmail sending mailbox
# ---------------------------------------------------------------------------

def load_legacy_gmail_tokens(path: Path = LEGACY_GMAIL_TOKENS_FILE) -> Optional[Dict[str, str]]:
    """Parse backend/.gmail_tokens (brand 1's legacy sending mailbox) or None."""
    if not path.is_file():
        return None
    tokens: Dict[str, str] = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line and "=" in line:
                key, value = line.split("=", 1)
                tokens[key] = value
    return tokens


def brand_base_mailbox(brand_id: Optional[str] = None) -> Optional[dict]:
    """The brand's connected base mailbox: its active email_accounts row that
    holds a refresh token (oldest first). None when the brand has none."""
    from database.client import get_supabase_admin_client

    with ensure_brand_scope(brand_id):
        rows = (
            get_supabase_admin_client()
            .table("email_accounts")
            .select("id, email, refresh_token, access_token, status, is_active, created_at")
            .neq("refresh_token", "")
            .eq("status", "active")
            .order("created_at")
            .execute()
        ).data or []
    for r in rows:
        if r.get("refresh_token") and r.get("is_active") is not False:
            return r
    return None


def brand_gmail_credentials(brand_id: Optional[str] = None) -> Dict[str, Optional[str]]:
    """Credentials of the mailbox the brand sends through.

    Brand 1 keeps using backend/.gmail_tokens when present (exact legacy
    behaviour); every other brand (and brand 1 without the file) uses its base
    mailbox row in email_accounts. Raises FileNotFoundError when there is none.

    Returns {"email", "refresh_token", "access_token", "source"}.
    """
    bid = str(brand_id or tenancy.require_brand())
    if is_default_brand(bid):
        tokens = load_legacy_gmail_tokens()
        if tokens and tokens.get("GMAIL_REFRESH_TOKEN"):
            return {
                "email": tokens.get("GMAIL_EMAIL"),
                "refresh_token": tokens.get("GMAIL_REFRESH_TOKEN"),
                "access_token": tokens.get("GMAIL_ACCESS_TOKEN"),
                "source": str(LEGACY_GMAIL_TOKENS_FILE),
            }
    row = brand_base_mailbox(bid)
    if not row:
        raise FileNotFoundError(
            f"No connected sending mailbox for brand {bid} "
            f"(connect a Gmail account under Email Accounts)"
        )
    return {
        "email": row["email"],
        "refresh_token": row.get("refresh_token"),
        "access_token": row.get("access_token"),
        "source": f"email_accounts:{row['id']}",
    }
