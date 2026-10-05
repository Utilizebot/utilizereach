"""
Multi-brand (multi-tenant) context.

Every tenant row carries a brand_id. The ACTIVE brand for the current unit of
work - an HTTP request, a sender run, a Celery task, a cron handler - lives in
a ContextVar. database/pg.py reads it on every statement to:

  1. set the Postgres settings app.brand_id / app.tenancy_bypass inside the
     statement's own transaction (drives the brand_id column DEFAULT and the
     row-level-security policies), and
  2. auto-scope query-builder reads and writes on tenant tables.

With no brand set and no system scope, any query that touches a tenant table
FAILS CLOSED (TenancyError) instead of silently reading or writing across
brands.

Setting the brand:
    with brand_scope(brand_id):        # sender runs, Celery tasks, handlers
        ...
    token = set_current_brand(brand_id)  # request dependency (api/dependencies.py)

Trusted cross-brand code (migrations, tracking-token lookups that must find the
brand first, platform-admin aggregates) uses:
    with system_scope():
        ...
Inside system_scope there is no automatic filtering and inserts into tenant
tables must carry brand_id explicitly.

This module must not import database.pg (pg imports it).
"""

from __future__ import annotations

import contextvars
from contextlib import contextmanager
from typing import Iterator, Optional

# Brand 1: the pre-existing deployment. Fixed so every backfill, seed and
# default resolves to the same row. See database/multibrand.sql.
DEFAULT_BRAND_ID = "00000000-0000-0000-0000-0000000000a1"
DEFAULT_BRAND_SLUG = "default"

# KEEP IN SYNC with the tenant_tables arrays in database/multibrand.sql.
TENANT_TABLES = frozenset({
    "scraped_leads", "scraping_jobs", "scraping_logs",
    "campaigns", "sent_emails", "email_queue",
    "email_clicks", "email_replies", "email_bounces", "email_unsubscribes",
    "email_exclusions", "email_accounts", "segments",
    "email_ai_settings", "scheduler_settings", "scheduler_run_history",
    "form_sessions", "form_responses", "form_steps", "tracking_events",
    "api_keys", "social_media_accounts", "social_media_posts",
    "stakeholders", "shareholder_profiles", "partner_profiles", "govt_agency_profiles",
    "staging_legacy_contacts", "stakeholder_audit_logs", "agent_execution_approvals",
    # analytics view over form_sessions/form_responses (security_invoker)
    "analytics_overview",
})


class TenancyError(RuntimeError):
    """A tenant table was touched without an active brand (or across brands)."""


_brand: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("tenancy_brand_id", default=None)
_system: contextvars.ContextVar[bool] = contextvars.ContextVar("tenancy_system", default=False)


def current_brand() -> Optional[str]:
    """The active brand id for this unit of work, or None."""
    return _brand.get()


def in_system_scope() -> bool:
    """True inside system_scope(): trusted code that may cross brands."""
    return _system.get()


def require_brand() -> str:
    """The active brand id; raises TenancyError when none is set."""
    brand = _brand.get()
    if not brand:
        raise TenancyError("No active brand for this operation")
    return brand


def set_current_brand(brand_id: Optional[str]) -> contextvars.Token:
    """Set the active brand; returns a token for reset_current_brand()."""
    return _brand.set(str(brand_id) if brand_id else None)


def reset_current_brand(token: contextvars.Token) -> None:
    _brand.reset(token)


@contextmanager
def brand_scope(brand_id: str) -> Iterator[str]:
    """Run a block as `brand_id` (and NOT in system scope)."""
    if not brand_id:
        raise TenancyError("brand_scope() needs a brand id")
    b_tok = _brand.set(str(brand_id))
    s_tok = _system.set(False)
    try:
        yield str(brand_id)
    finally:
        _system.reset(s_tok)
        _brand.reset(b_tok)


@contextmanager
def system_scope() -> Iterator[None]:
    """Run a block with tenancy bypassed (trusted, cross-brand code only)."""
    tok = _system.set(True)
    try:
        yield
    finally:
        _system.reset(tok)
