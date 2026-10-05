"""
Configuration module for Marketing AI backend

Team (sending personas) and company information, PER BRAND:

  * Brand 1 (the default brand / pre-existing deployment) -> config/team_config.json,
    read exactly as before (legacy, identical output).
  * Every other brand -> built from that brand's data:
      personas: its email_accounts persona rows (send-as aliases), else
                brands.branding.emailTeam, else its connected base mailbox;
      company:  its email_ai_settings (company_name / tagline) +
                brands.branding.company + brands.website_domain.

The brand is the ACTIVE brand (database.tenancy) unless `brand_id` is passed.
With no active brand at all (import time, legacy callers) the legacy brand-1
file is returned - it is a file, not tenant data, so nothing crosses brands.
Caches are keyed by brand id.
"""

import os
import json
import threading
import time
from pathlib import Path
from typing import List, Dict, Any, Optional

# Default team config path
CONFIG_DIR = Path(__file__).parent
TEAM_CONFIG_FILE = CONFIG_DIR / "team_config.json"

# Other brands: short-lived cache keyed by brand id (persona/settings edits in
# the UI show up within this many seconds; call reload_config() to force).
_BRAND_CACHE_TTL = 30.0
_brand_cache: Dict[str, Dict[str, Any]] = {}
_brand_cache_lock = threading.Lock()

# email_ai_settings.company_name column default (placeholder, never a real name)
_PLACEHOLDER_COMPANY_NAMES = {"", "your company name", "your company"}


def load_team_config() -> Dict[str, Any]:
    """
    Load team configuration from JSON file (brand 1 / legacy)

    Returns:
        Dict containing company info and email team members
    """
    config_file = os.getenv("TEAM_CONFIG_FILE", str(TEAM_CONFIG_FILE))

    try:
        with open(config_file, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Warning: Team config file not found at {config_file}, using defaults")
        return get_default_config()
    except json.JSONDecodeError as e:
        print(f"Warning: Invalid JSON in team config file: {e}, using defaults")
        return get_default_config()


def get_default_config() -> Dict[str, Any]:
    """Return default configuration"""
    return {
        "company": {
            "name": "Your Company",
            "website": "https://www.yourcompany.com",
            "industry": "Technology"
        },
        "emailTeam": [
            {
                "email": "sales@yourcompany.com",
                "name": "Sales Team",
                "title": "Sales Representative",
                "persona": "professional and helpful",
                "focus": "customer success"
            }
        ]
    }


# ---------------------------------------------------------------------------
# Brand resolution
# ---------------------------------------------------------------------------

def _target_brand(brand_id: Optional[str]) -> Optional[str]:
    """Brand to read config for: explicit brand_id, else the active brand.

    None means "no brand context at all" -> legacy brand-1 file.
    Naming a different brand from inside another brand's scope is refused.
    """
    from database import tenancy

    active = tenancy.current_brand()
    if brand_id:
        brand_id = str(brand_id)
        if active and active != brand_id and not tenancy.in_system_scope():
            raise tenancy.TenancyError(
                f"Refusing to read brand {brand_id} config while acting as {active}"
            )
        return brand_id
    return active


def _is_legacy(brand_id: Optional[str]) -> bool:
    from database.tenancy import DEFAULT_BRAND_ID
    return not brand_id or str(brand_id) == DEFAULT_BRAND_ID


def _run_as(brand_id: str, fn):
    """Run fn() with `brand_id` active (no-op when it already is)."""
    from database import tenancy

    if tenancy.current_brand() == brand_id and not tenancy.in_system_scope():
        return fn()
    with tenancy.brand_scope(brand_id):
        return fn()


# ---------------------------------------------------------------------------
# Non-default brands: built from the brand's own data
# ---------------------------------------------------------------------------

def _persona_from_account(row: Dict[str, Any]) -> Dict[str, str]:
    email = row.get("email") or ""
    name = (row.get("sender_name") or row.get("display_name") or email.split("@")[0]).strip()
    persona: Dict[str, str] = {
        "email": email,
        "name": name,
        "title": row.get("sender_title") or "Team Member",
    }
    if row.get("persona"):
        persona["persona"] = row["persona"]
    if row.get("focus_area"):
        persona["focus"] = row["focus_area"]
    return persona


def _load_brand_team(brand_id: str, brand: Optional[dict]) -> List[Dict[str, str]]:
    from database.client import get_supabase_admin_client

    def _rows():
        return (
            get_supabase_admin_client()
            .table("email_accounts")
            .select("email, display_name, sender_name, sender_title, persona, focus_area, "
                    "refresh_token, status, is_active, created_at")
            .eq("status", "active")
            .order("created_at")
            .execute()
        ).data or []

    rows = [r for r in _run_as(brand_id, _rows) if r.get("is_active") is not False and r.get("email")]
    rows.sort(key=lambda r: (r.get("created_at") or "", r.get("email") or ""))

    # 1) persona rows = send-as aliases (no OAuth token of their own)
    aliases = [r for r in rows if not r.get("refresh_token")]
    if aliases:
        return [_persona_from_account(r) for r in aliases]

    # 2) personas configured on the brand itself (same shape as team_config.json)
    configured = ((brand or {}).get("branding") or {}).get("emailTeam") or []
    configured = [dict(p) for p in configured if isinstance(p, dict) and p.get("email")]
    if configured:
        return configured

    # 3) the connected base mailbox(es) as the only persona(s)
    return [_persona_from_account(r) for r in rows]


def _load_brand_company(brand_id: str, brand: Optional[dict]) -> Dict[str, str]:
    from database.client import get_supabase_admin_client

    def _settings():
        res = (
            get_supabase_admin_client()
            .table("email_ai_settings")
            .select("company_name, company_tagline")
            .limit(1)
            .execute()
        )
        return res.data[0] if res.data else {}

    try:
        settings = _run_as(brand_id, _settings)
    except Exception as e:
        print(f"[config] Could not read email_ai_settings for brand {brand_id}: {e}")
        settings = {}

    brand = brand or {}
    branding_company = dict(((brand.get("branding") or {}).get("company")) or {})

    ai_name = (settings.get("company_name") or "").strip()
    if ai_name.lower() in _PLACEHOLDER_COMPANY_NAMES:
        ai_name = ""
    domain = (brand.get("website_domain") or "").strip()

    company: Dict[str, str] = dict(branding_company)
    company["name"] = ai_name or branding_company.get("name") or brand.get("display_name") or ""
    company["website"] = branding_company.get("website") or (f"https://{domain}" if domain else "")
    company["industry"] = branding_company.get("industry") or ""
    tagline = settings.get("company_tagline") or branding_company.get("tagline")
    if tagline:
        company["tagline"] = tagline
    return company


def _brand_config(brand_id: str, refresh: bool = False) -> Dict[str, Any]:
    """{"company": {...}, "emailTeam": [...]} for a non-default brand (cached)."""
    now = time.monotonic()
    with _brand_cache_lock:
        hit = _brand_cache.get(brand_id)
        if hit and not refresh and now - hit["at"] < _BRAND_CACHE_TTL:
            return hit["config"]

    from database import brands as brand_catalog
    brand = brand_catalog.get_brand(brand_id)
    if brand is None:
        from database.tenancy import TenancyError
        raise TenancyError(f"Unknown brand {brand_id!r}")

    config = {
        "company": _load_brand_company(brand_id, brand),
        "emailTeam": _load_brand_team(brand_id, brand),
    }
    with _brand_cache_lock:
        _brand_cache[brand_id] = {"at": time.monotonic(), "config": config}
    return config


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_email_team(brand_id: Optional[str] = None) -> List[Dict[str, str]]:
    """
    Get list of email team members (sending personas) of the active brand

    Returns:
        List of team member dicts with email, name, title, persona, focus
    """
    target = _target_brand(brand_id)
    if _is_legacy(target):
        config = load_team_config()
        return config.get("emailTeam", [])
    return [dict(p) for p in _brand_config(target).get("emailTeam", [])]


def get_company_info(brand_id: Optional[str] = None) -> Dict[str, str]:
    """
    Get company information of the active brand

    Returns:
        Dict with company name, website, industry
    """
    target = _target_brand(brand_id)
    if _is_legacy(target):
        config = load_team_config()
        return config.get("company", {})
    return dict(_brand_config(target).get("company", {}))


# Legacy (brand 1) file cache
_cached_config = None
_cached_config_lock = threading.Lock()


def get_config(brand_id: Optional[str] = None) -> Dict[str, Any]:
    """Get cached config of the active brand ({"company", "emailTeam", ...})"""
    global _cached_config
    target = _target_brand(brand_id)
    if _is_legacy(target):
        with _cached_config_lock:
            if _cached_config is None:
                _cached_config = load_team_config()
            return _cached_config
    return _brand_config(target)


def reload_config(brand_id: Optional[str] = None):
    """Force reload of config (the active brand's; brand 1 = file)"""
    global _cached_config
    target = _target_brand(brand_id)
    if _is_legacy(target):
        with _cached_config_lock:
            _cached_config = load_team_config()
            return _cached_config
    return _brand_config(target, refresh=True)


def invalidate_brand_config(brand_id: Optional[str] = None) -> None:
    """Drop cached personas/company for one brand (or all) - call after edits."""
    with _brand_cache_lock:
        if brand_id:
            _brand_cache.pop(str(brand_id), None)
        else:
            _brand_cache.clear()
