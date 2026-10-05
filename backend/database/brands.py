"""
Brand catalog access (the `brands` table is global, not a tenant table).

    get_brand(ref)            -> brand dict by id or slug (cached briefly)
    list_brands(active_only)  -> all brands
    brand_for_host(host)      -> brand whose `hostnames` contains host, or None
    default_brand()           -> brand 1 (the pre-existing deployment)
    is_default_brand(ref)     -> bool
    sender_value(...)         -> per-brand sender setting with safe fallbacks

Brand dict keys: id, slug, display_name, website_domain, hostnames,
unsub_salt, is_active, branding (dict), sender (dict), created_at, updated_at.
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any, Dict, List, Optional

from database.pg import execute_sql
from database.tenancy import DEFAULT_BRAND_ID

_CACHE_TTL = 30.0
_cache: Dict[str, Any] = {"at": 0.0, "rows": []}
_lock = threading.Lock()


def _load_all() -> List[dict]:
    with _lock:
        if time.monotonic() - _cache["at"] < _CACHE_TTL and _cache["rows"]:
            return _cache["rows"]
        rows = execute_sql(
            "SELECT id, slug, display_name, website_domain, hostnames, unsub_salt, is_active, "
            "branding, sender, created_at, updated_at FROM brands ORDER BY created_at, slug"
        )
        for r in rows:
            r["branding"] = r.get("branding") or {}
            r["sender"] = r.get("sender") or {}
            r["hostnames"] = [h.lower() for h in (r.get("hostnames") or [])]
        _cache["rows"] = rows
        _cache["at"] = time.monotonic()
        return rows


def invalidate_cache() -> None:
    """Call after creating/updating a brand."""
    with _lock:
        _cache["at"] = 0.0
        _cache["rows"] = []


def list_brands(active_only: bool = True) -> List[dict]:
    rows = _load_all()
    return [r for r in rows if r.get("is_active")] if active_only else list(rows)


def get_brand(ref: Optional[str]) -> Optional[dict]:
    """Brand by id or slug (inactive brands included)."""
    if not ref:
        return None
    ref = str(ref).strip().lower()
    for r in _load_all():
        if r["id"] == ref or r["slug"] == ref:
            return r
    return None


def default_brand() -> dict:
    b = get_brand(DEFAULT_BRAND_ID)
    if not b:
        raise RuntimeError("Default brand missing - has database/multibrand.sql run?")
    return b


def is_default_brand(ref) -> bool:
    if isinstance(ref, dict):
        ref = ref.get("id")
    return str(ref or "") == DEFAULT_BRAND_ID


def brand_for_host(host: Optional[str]) -> Optional[dict]:
    """The active brand that claims this hostname (port stripped), or None.

    Only brand-DEDICATED hosts are listed in brands.hostnames; a shared
    dashboard host maps to no brand and the user's token decides.
    """
    if not host:
        return None
    h = host.split(":")[0].strip().lower()
    if not h:
        return None
    for r in list_brands(active_only=True):
        if h in r["hostnames"]:
            return r
    return None


def sender_value(brand: dict, key: str, env: Optional[str] = None, default: Any = None,
                 env_for_all_brands: bool = True) -> Any:
    """Resolve one sender setting for a brand.

    Order: brand.sender[key] -> environment variable `env` -> default.
    Identity-type settings (CTA, alert sender, AI brief...) should pass
    env_for_all_brands=False so another brand never inherits brand 1's values
    from the cron environment.
    """
    cfg = (brand or {}).get("sender") or {}
    if key in cfg and cfg[key] not in (None, ""):
        return cfg[key]
    if env and (env_for_all_brands or is_default_brand(brand)):
        val = os.getenv(env)
        if val not in (None, ""):
            return val
    return default
