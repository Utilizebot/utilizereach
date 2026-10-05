"""
Brands router - the multi-brand control plane.

  GET   /api/brands/public-config           public: Host-resolved branding (config.json shape)
  POST  /api/brands/switch                  switch the session to another brand (new token)
  GET   /api/brands/current                 the active brand
  PATCH /api/brands/current                 edit the active brand (settings.manage)
  GET   /api/brands                         every brand + counts (platform admin)
  POST  /api/brands                         create a brand (platform admin)
  PATCH /api/brands/{brand_id}              edit any brand (platform admin)
  GET/POST/PATCH/DELETE /api/brands/current/members[...]   brand team (users.view / users.manage)

The brands table is global (not a tenant table); everything a brand OWNS
(leads, campaigns, mailboxes, settings...) lives in tenant tables scoped by
brand_id. See docs/MULTIBRAND.md.
"""

from __future__ import annotations

import copy
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from api import membership
from api.dependencies import (
    get_current_user, public_brand, require_permission, require_platform_admin, _request_host,
)
from api.routers.auth import session_for
from database import brands as brand_catalog
from database.pg import execute_sql
from database.tenancy import DEFAULT_BRAND_ID, brand_scope, system_scope

router = APIRouter(prefix="/api/brands", tags=["brands"])

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")

# Legacy single-brand config file (brand 1 keeps serving it as its base).
_SHARED_CONFIG_PATHS = [Path("/app/shared_config/config.json"), Path("/app/config/config.json")]

_DEFAULT_PUBLIC_CONFIG: Dict[str, Any] = {
    "setup": {"completed": True, "apiUrl": ""},
    "company": {"name": "", "tagline": "", "logo": "/logo.png", "website": "", "email": "", "phone": ""},
    "branding": {"primaryColor": "#2aa8e0", "secondaryColor": "#0d78b0", "accentColor": "#30b9eb"},
    "form": {"title": "Request a demo", "subtitle": "", "successMessage": "Thanks! We'll be in touch."},
    "dashboard": {"title": "Lead Analytics", "subtitle": ""},
    "emailTeam": [],
    "features": {"enableScraper": True, "enableScheduler": True, "enableEmailTracking": True, "enableAIEmails": True},
}

_PUBLIC_BRANDING_KEYS = ("company", "branding", "form", "dashboard", "features", "emailTeam")


def _deep_merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        elif v not in (None, ""):
            out[k] = v
    return out


def _merge_patch(base: dict, patch: dict) -> dict:
    """JSON-merge-patch: nested dicts merge, None / "" deletes the key."""
    out = copy.deepcopy(base or {})
    for k, v in (patch or {}).items():
        if v is None or v == "":
            out.pop(k, None)
        elif isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge_patch(out[k], v)
        else:
            out[k] = v
    return out


def _invalidate(brand_id: str) -> None:
    brand_catalog.invalidate_cache()
    try:
        from config import invalidate_brand_config
        invalidate_brand_config(brand_id)
    except Exception:
        pass


def _legacy_shared_config() -> dict:
    for p in _SHARED_CONFIG_PATHS:
        try:
            if p.exists():
                return json.loads(p.read_text())
        except (OSError, ValueError):
            continue
    return {}


def build_public_config(brand: dict) -> dict:
    """config.json-shaped payload for a brand (what the frontend renders with)."""
    cfg = copy.deepcopy(_DEFAULT_PUBLIC_CONFIG)
    if brand_catalog.is_default_brand(brand):
        cfg = _deep_merge(cfg, _legacy_shared_config())
    cfg = _deep_merge(cfg, {k: v for k, v in (brand.get("branding") or {}).items() if k in _PUBLIC_BRANDING_KEYS})
    if not (cfg.get("company") or {}).get("name"):
        cfg.setdefault("company", {})["name"] = brand["display_name"]
    if not (cfg.get("company") or {}).get("website") and brand.get("website_domain"):
        cfg["company"]["website"] = f"https://{brand['website_domain']}"
    cfg["setup"] = {**(cfg.get("setup") or {}), "completed": True}
    return cfg


def _brand_out(b: dict, full: bool = True) -> dict:
    out = {
        "id": b["id"], "slug": b["slug"], "display_name": b["display_name"],
        "website_domain": b.get("website_domain"), "is_active": b.get("is_active"),
        "is_default": brand_catalog.is_default_brand(b),
    }
    if full:
        out.update({
            "hostnames": b.get("hostnames") or [], "branding": b.get("branding") or {},
            "sender": b.get("sender") or {}, "created_at": b.get("created_at"), "updated_at": b.get("updated_at"),
        })
    return out


def _fresh(brand_id: str) -> dict:
    _invalidate(brand_id)
    b = brand_catalog.get_brand(brand_id)
    if not b:
        raise HTTPException(status_code=404, detail="Brand not found")
    return b


# ---------------------------------------------------------------------------
# Public
# ---------------------------------------------------------------------------

@router.get("/public-config")
async def public_config(request: Request):
    """Branding for the brand that owns this Host (else the default brand). No auth."""
    brand = public_brand(request)
    return {"brand": _brand_out(brand, full=False), "config": build_public_config(brand)}


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------

class SwitchRequest(BaseModel):
    brand_id: str


@router.post("/switch")
async def switch_brand(body: SwitchRequest, request: Request, current_user: dict = Depends(get_current_user)):
    """Start acting in another brand: returns a new token bound to it."""
    target = brand_catalog.get_brand(body.brand_id)
    if not target or not target.get("is_active"):
        raise HTTPException(status_code=404, detail="Brand not found")
    allowed = current_user.get("is_platform_admin") or any(b["id"] == target["id"] for b in current_user.get("brands", []))
    if not allowed:
        raise HTTPException(status_code=403, detail="You are not a member of that brand")
    rows = execute_sql("SELECT * FROM sales_reps WHERE id = %s", [current_user["id"]])
    session = session_for(rows[0], target["id"], _request_host(request))
    if session["user"]["brand_id"] != target["id"]:
        # a brand-dedicated Host pins the brand; switching must happen on the shared host
        raise HTTPException(status_code=409, detail="This address is dedicated to another brand")
    return session


@router.get("/current")
async def current_brand(current_user: dict = Depends(get_current_user)):
    return _brand_out(_fresh(current_user["brand_id"]))


# ---------------------------------------------------------------------------
# Editing
# ---------------------------------------------------------------------------

class BrandUpdate(BaseModel):
    display_name: Optional[str] = None
    website_domain: Optional[str] = None
    hostnames: Optional[List[str]] = None
    is_active: Optional[bool] = None
    branding: Optional[Dict[str, Any]] = None
    sender: Optional[Dict[str, Any]] = None


def _norm_domain(d: Optional[str]) -> Optional[str]:
    if d is None:
        return None
    d = d.strip().lower()
    d = re.sub(r"^https?://", "", d).strip("/")
    return d or None


def _apply_update(brand_id: str, body: BrandUpdate, platform: bool) -> dict:
    current = brand_catalog.get_brand(brand_id)
    if not current:
        raise HTTPException(status_code=404, detail="Brand not found")
    sets, params = [], []
    if body.display_name is not None:
        if not body.display_name.strip():
            raise HTTPException(status_code=400, detail="Display name cannot be empty")
        sets.append("display_name = %s"); params.append(body.display_name.strip())
    if body.website_domain is not None:
        sets.append("website_domain = %s"); params.append(_norm_domain(body.website_domain))
    if body.branding is not None:
        merged = _merge_patch(current.get("branding") or {}, body.branding)
        sets.append("branding = %s"); params.append(Jsonb(merged))
    if body.sender is not None:
        merged = _merge_patch(current.get("sender") or {}, body.sender)
        sets.append("sender = %s"); params.append(Jsonb(merged))
    if body.hostnames is not None or body.is_active is not None:
        if not platform:
            raise HTTPException(status_code=403, detail="Only a platform admin can change hostnames or activation")
        if body.hostnames is not None:
            hosts = sorted({h.strip().lower() for h in body.hostnames if h and h.strip()})
            clash = execute_sql(
                "SELECT slug FROM brands WHERE id <> %s AND hostnames && %s::text[]", [brand_id, hosts]
            ) if hosts else []
            if clash:
                raise HTTPException(status_code=400, detail=f"Hostname already used by brand '{clash[0]['slug']}'")
            sets.append("hostnames = %s::text[]"); params.append(hosts)
        if body.is_active is not None:
            if not body.is_active and brand_catalog.is_default_brand(brand_id):
                raise HTTPException(status_code=400, detail="The default brand cannot be deactivated")
            sets.append("is_active = %s"); params.append(body.is_active)
    if not sets:
        return _brand_out(current)
    sets.append("updated_at = NOW()")
    execute_sql(f"UPDATE brands SET {', '.join(sets)} WHERE id = %s", params + [brand_id])
    return _brand_out(_fresh(brand_id))


@router.patch("/current")
async def update_current_brand(body: BrandUpdate, current_user: dict = Depends(require_permission("settings.manage"))):
    return _apply_update(current_user["brand_id"], body, bool(current_user.get("is_platform_admin")))


# ---------------------------------------------------------------------------
# Platform admin
# ---------------------------------------------------------------------------

def _counts() -> Dict[str, Dict[str, int]]:
    out: Dict[str, Dict[str, int]] = {}
    with system_scope():
        for key, sql in (
            ("lead_count", "SELECT brand_id, count(*) AS n FROM scraped_leads GROUP BY brand_id"),
            ("campaign_count", "SELECT brand_id, count(*) AS n FROM campaigns GROUP BY brand_id"),
            ("sent_count", "SELECT brand_id, count(*) AS n FROM sent_emails GROUP BY brand_id"),
            ("mailbox_count", "SELECT brand_id, count(*) AS n FROM email_accounts GROUP BY brand_id"),
        ):
            for r in execute_sql(sql):
                out.setdefault(r["brand_id"], {})[key] = int(r["n"])
    for r in execute_sql("SELECT brand_id, count(*) AS n FROM brand_members GROUP BY brand_id"):
        out.setdefault(r["brand_id"], {})["member_count"] = int(r["n"])
    return out


@router.get("")
@router.get("/")
async def list_all_brands(current_user: dict = Depends(require_platform_admin)):
    counts = _counts()
    brands = []
    for b in brand_catalog.list_brands(active_only=False):
        row = _brand_out(b)
        row.update({k: 0 for k in ("lead_count", "campaign_count", "sent_count", "mailbox_count", "member_count")})
        row.update(counts.get(b["id"], {}))
        brands.append(row)
    return {"brands": brands}


class BrandCreate(BaseModel):
    slug: str
    display_name: str
    website_domain: Optional[str] = None
    hostnames: Optional[List[str]] = None
    branding: Optional[Dict[str, Any]] = None
    sender: Optional[Dict[str, Any]] = None


@router.post("")
@router.post("/")
async def create_brand(body: BrandCreate, current_user: dict = Depends(require_platform_admin)):
    slug = (body.slug or "").strip().lower()
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Slug: 2-41 chars, lowercase letters, digits and dashes, starting with a letter or digit")
    if not (body.display_name or "").strip():
        raise HTTPException(status_code=400, detail="Display name is required")
    if execute_sql("SELECT 1 FROM brands WHERE slug = %s", [slug]):
        raise HTTPException(status_code=400, detail=f"A brand with slug '{slug}' already exists")
    domain = _norm_domain(body.website_domain)
    sender = {"sending_enabled": False, **(body.sender or {})}
    branding = body.branding or {}
    rows = execute_sql(
        "INSERT INTO brands (slug, display_name, website_domain, branding, sender) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id",
        [slug, body.display_name.strip(), domain, Jsonb(branding), Jsonb(sender)],
    )
    brand_id = rows[0]["id"]
    brand_catalog.invalidate_cache()
    if body.hostnames:
        _apply_update(brand_id, BrandUpdate(hostnames=body.hostnames), platform=True)

    company = (branding.get("company") or {}) if isinstance(branding, dict) else {}
    website = f"https://{domain}" if domain else "https://example.com"
    # The brand's own settings rows (former singletons are one row per brand).
    with brand_scope(brand_id):
        execute_sql(
            "INSERT INTO email_ai_settings (company_name, company_tagline, company_services, "
            "cta_link_1_label, cta_link_1_url, cta_link_2_label, cta_link_2_url, email_word_limit, email_tone) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (brand_id) DO NOTHING",
            [company.get("name") or body.display_name.strip(), company.get("tagline") or "",
             "", "Schedule a Call", website, "Learn More", website, 150, "professional but conversational"],
        )
        execute_sql(
            "INSERT INTO scheduler_settings (is_enabled, daily_limit, send_hour, send_minute, timezone, delay_between_emails) "
            "VALUES (FALSE, 30, 10, 0, 'Asia/Kuala_Lumpur', 60) ON CONFLICT (brand_id) DO NOTHING",
        )
    # The creator administers the new brand.
    execute_sql(
        "INSERT INTO brand_members (brand_id, sales_rep_id, role, is_default) VALUES (%s, %s, 'admin', FALSE) "
        "ON CONFLICT (brand_id, sales_rep_id) DO NOTHING",
        [brand_id, current_user["id"]],
    )
    return {"brand": _brand_out(_fresh(brand_id))}


@router.patch("/{brand_id}")
async def update_brand(brand_id: str, body: BrandUpdate, current_user: dict = Depends(require_platform_admin)):
    return _apply_update(brand_id, body, platform=True)


# ---------------------------------------------------------------------------
# Members of the active brand
# ---------------------------------------------------------------------------

class MemberCreate(BaseModel):
    email: str
    full_name: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = "member"


class MemberUpdate(BaseModel):
    role: str


class PasswordReset(BaseModel):
    new_password: str


@router.get("/current/members")
async def list_members(current_user: dict = Depends(require_permission("users.view"))):
    return {"brand": {"id": current_user["brand_id"], "display_name": current_user["brand_name"]},
            "members": membership.list_members(current_user["brand_id"])}


@router.post("/current/members")
async def add_member(body: MemberCreate, current_user: dict = Depends(require_permission("users.manage"))):
    res = membership.add_member(current_user["brand_id"], current_user, body.email, body.role,
                                body.full_name, body.password)
    return {"success": True, **res}


@router.patch("/current/members/{user_id}")
async def update_member(user_id: str, body: MemberUpdate, current_user: dict = Depends(require_permission("users.manage"))):
    return {"success": True, **membership.update_member_role(current_user["brand_id"], current_user, user_id, body.role)}


@router.delete("/current/members/{user_id}")
async def remove_member(user_id: str, current_user: dict = Depends(require_permission("users.manage"))):
    return {"success": True, **membership.remove_member(current_user["brand_id"], current_user, user_id)}


@router.post("/current/members/{user_id}/reset-password")
async def reset_member_password(user_id: str, body: PasswordReset,
                                current_user: dict = Depends(require_permission("users.manage"))):
    return {"success": True, **membership.reset_member_password(current_user["brand_id"], current_user, user_id, body.new_password)}
