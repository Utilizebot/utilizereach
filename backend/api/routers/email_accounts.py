"""
Email Accounts Router
API endpoints for managing email sending accounts and viewing their statistics
Includes Google OAuth integration for Gmail accounts

Multi-brand: every endpoint on `router` runs inside an authenticated request,
so the active brand is bound and every query-builder call on email_accounts /
sent_emails is scoped to it automatically. Mailboxes are GLOBALLY unique (a
mailbox belongs to exactly one brand).

The Google OAuth callback is PUBLIC (Google redirects the browser there, no
JWT), so it lives on `public_router` (mount it WITHOUT the auth dependency).
The brand travels through Google in the OAuth `state` as a short-lived signed
token minted by google_auth_start; the callback verifies it and does all its
writes inside brand_scope(<that brand>).

OAuth secrets (access_token / refresh_token) are NEVER returned by the API:
every account row goes through _public_account() first, which replaces them
with a `has_tokens` flag.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from urllib.parse import quote
import os
import re
import json
import uuid
import secrets as _secrets
from typing import Optional

from pydantic import BaseModel

import jwt as pyjwt

from database.client import get_supabase_admin_client
from database.pg import execute_sql
from database import brands as brand_catalog
from database import tenancy
from database.tenancy import brand_scope, system_scope
from api.dependencies import require_permission, resolve_user_brand
from api.permissions import has_permission
from api.security import JWT_ALGORITHM, get_jwt_secret
from datetime import datetime, timedelta, timezone
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

router = APIRouter(prefix="/api/email-accounts", tags=["Email Accounts"])

# Public (no JWT) routes: only the Google OAuth redirect target.
public_router = APIRouter(prefix="/api/email-accounts", tags=["Email Accounts"])

# Google OAuth Configuration (one OAuth app for the whole platform)
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")

# Signed OAuth `state` (brand + user travel through Google in it)
_OAUTH_STATE_PURPOSE = "gmail_oauth"
_OAUTH_STATE_TTL = timedelta(minutes=15)


def get_public_base_url(request: Request) -> str:
    """Public base URL used to build the OAuth redirect_uri.

    This MUST match the redirect URI registered in Google Cloud exactly.
    Behind a reverse proxy / Cloudflare tunnel the request reaches the backend
    over http internally, so header-derived schemes are unreliable — prefer an
    explicitly configured public URL.
    """
    for var in ("PUBLIC_BASE_URL", "BACKEND_URL", "FRONTEND_URL"):
        v = os.getenv(var, "").strip()
        if v.startswith("http"):
            return v.rstrip('/')
    host = request.headers.get('host', 'localhost:8000')
    scheme = request.headers.get('x-forwarded-proto', 'http')
    return f"{scheme}://{host}"


def get_frontend_url(request: Request) -> str:
    """Derive frontend URL from request headers (works with nginx proxy)"""
    # First check env var
    env_url = os.getenv("FRONTEND_URL", "")
    if env_url:
        return env_url.rstrip('/')

    # Otherwise derive from request
    host = request.headers.get('host', 'localhost:3000')
    scheme = request.headers.get('x-forwarded-proto', 'http')

    # In dev mode, frontend is on port 3000 while backend is on 8000
    if ':8000' in host:
        host = host.replace(':8000', ':3000')

    return f"{scheme}://{host}"

# Gmail API Scopes
GMAIL_SCOPES = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.settings.basic',
    'https://www.googleapis.com/auth/gmail.settings.sharing',
    'https://www.googleapis.com/auth/userinfo.email',
    'openid'
]


def get_supabase():
    """Get database client"""
    return get_supabase_admin_client()


_SECRET_ACCOUNT_FIELDS = ("access_token", "refresh_token")


def _public_account(row: dict) -> dict:
    """An email_accounts row safe to return to any caller: the OAuth tokens
    are stripped and replaced by a boolean `has_tokens`."""
    out = dict(row or {})
    has_tokens = any(out.get(k) for k in _SECRET_ACCOUNT_FIELDS)
    for k in _SECRET_ACCOUNT_FIELDS:
        out.pop(k, None)
    out["has_tokens"] = bool(has_tokens)
    return out


def _brand_team_and_company() -> tuple:
    """(emailTeam, company) for the ACTIVE brand.

    Brand 1 keeps the legacy shared team config (config/team_config.json),
    exactly as before. Other brands use their own brands.branding and never
    fall back to brand 1's file.
    """
    brand_id = tenancy.require_brand()
    if brand_catalog.is_default_brand(brand_id):
        from config import get_email_team, get_company_info
        return get_email_team(), get_company_info()
    brand = brand_catalog.get_brand(brand_id) or {}
    branding = brand.get("branding") or {}
    # Same source the sender uses: persona rows, else branding.emailTeam, else
    # the connected mailbox itself (config._load_brand_team).
    from config import get_email_team
    team = get_email_team(brand_id)
    company = dict(branding.get("company") or {}) if isinstance(branding.get("company"), dict) else {}
    if not company.get("name"):
        company["name"] = brand.get("display_name", "")
    if not company.get("website") and brand.get("website_domain"):
        company["website"] = f"https://{brand['website_domain']}"
    return team, company


def _base_mailbox_email() -> str | None:
    """The active brand's sending base mailbox: its active account holding a
    refresh_token (oldest first); falls back to any active account."""
    brand_id = tenancy.require_brand()
    rows = execute_sql(
        "SELECT email FROM email_accounts "
        "WHERE brand_id = %s AND status = 'active' "
        "AND refresh_token IS NOT NULL AND refresh_token <> '' "
        "ORDER BY created_at NULLS LAST LIMIT 1",
        [brand_id],
    )
    if rows:
        return rows[0]["email"]
    accounts = get_supabase().table('email_accounts').select('email').eq('status', 'active').limit(1).execute()
    if accounts.data:
        return accounts.data[0]['email']
    return None


@router.get("/")
async def get_all_accounts(current_user: dict = Depends(require_permission("accounts.view"))):
    """
    Get all email accounts with their current statistics

    Returns:
    - List of all email accounts
    - Sending statistics for each account
    - Quota usage
    - Health metrics
    """
    try:
        supabase = get_supabase()

        # Get all email accounts
        accounts_result = supabase.table('email_accounts')\
            .select('*')\
            .execute()

        if not accounts_result.data:
            return {"accounts": [], "total": 0}

        accounts_with_stats = []

        for account in accounts_result.data:
            # Get emails sent by this account (all time)
            all_time_sent = supabase.table('sent_emails')\
                .select('id', count='exact')\
                .eq('from_email', account.get('email', ''))\
                .execute()

            total_sent = len(all_time_sent.data) if all_time_sent.data else 0

            # Get emails sent today
            today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            today_sent = supabase.table('sent_emails')\
                .select('id', count='exact')\
                .eq('from_email', account.get('email', ''))\
                .gte('sent_at', today_start.isoformat())\
                .execute()

            sent_today = len(today_sent.data) if today_sent.data else 0

            # Get emails sent this week
            week_start = datetime.utcnow() - timedelta(days=7)
            week_sent = supabase.table('sent_emails')\
                .select('id', count='exact')\
                .eq('from_email', account.get('email', ''))\
                .gte('sent_at', week_start.isoformat())\
                .execute()

            sent_this_week = len(week_sent.data) if week_sent.data else 0

            # Calculate remaining quota
            daily_limit = account.get('daily_limit', 50)
            remaining_today = max(0, daily_limit - sent_today)

            # Get engagement stats for this account
            account_emails = supabase.table('sent_emails')\
                .select('*')\
                .eq('from_email', account.get('email', ''))\
                .execute()

            opened_count = len([e for e in (account_emails.data or []) if e.get('opened_at')])
            clicked_count = len([e for e in (account_emails.data or []) if e.get('clicked')])
            replied_count = len([e for e in (account_emails.data or []) if e.get('replied')])

            # Calculate engagement rate
            open_rate = (opened_count / total_sent * 100) if total_sent > 0 else 0
            click_rate = (clicked_count / opened_count * 100) if opened_count > 0 else 0
            reply_rate = (replied_count / total_sent * 100) if total_sent > 0 else 0

            accounts_with_stats.append({
                **_public_account(account),
                "stats": {
                    "total_sent": total_sent,
                    "sent_today": sent_today,
                    "sent_this_week": sent_this_week,
                    "remaining_today": remaining_today,
                    "opened": opened_count,
                    "clicked": clicked_count,
                    "replied": replied_count,
                    "open_rate": round(open_rate, 1),
                    "click_rate": round(click_rate, 1),
                    "reply_rate": round(reply_rate, 1)
                }
            })

        return {
            "accounts": accounts_with_stats,
            "total": len(accounts_with_stats)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get accounts: {str(e)}")


@router.get("/stats")
async def get_accounts_summary(current_user: dict = Depends(require_permission("accounts.view"))):
    """
    Get summary statistics across all email accounts

    Returns:
    - Total accounts
    - Total emails sent
    - Combined quota usage
    - Overall health
    """
    try:
        supabase = get_supabase()

        # Get all accounts
        accounts = supabase.table('email_accounts').select('*').execute()

        total_accounts = len(accounts.data) if accounts.data else 0
        total_daily_limit = sum(a.get('daily_limit', 50) for a in (accounts.data or []))
        avg_health_score = sum(a.get('health_score', 100) for a in (accounts.data or [])) / total_accounts if total_accounts > 0 else 0

        # Get total emails sent today across all accounts
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        today_sent = supabase.table('sent_emails')\
            .select('id', count='exact')\
            .gte('sent_at', today_start.isoformat())\
            .execute()

        total_sent_today = len(today_sent.data) if today_sent.data else 0
        remaining_today = max(0, total_daily_limit - total_sent_today)

        # Get all time totals
        all_emails = supabase.table('sent_emails').select('id', count='exact').execute()
        total_all_time = len(all_emails.data) if all_emails.data else 0

        return {
            "total_accounts": total_accounts,
            "total_daily_limit": total_daily_limit,
            "total_sent_today": total_sent_today,
            "remaining_today": remaining_today,
            "total_sent_all_time": total_all_time,
            "avg_health_score": round(avg_health_score, 1),
            "usage_percentage": round((total_sent_today / total_daily_limit * 100) if total_daily_limit > 0 else 0, 1)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get summary: {str(e)}")


@router.get("/personas")
async def get_sending_personas(current_user: dict = Depends(require_permission("accounts.view"))):
    """List the AI sending personas (the active brand's team config). These
    are the identities campaigns rotate through — each sends via the brand's
    connected base account using its own send-as alias."""
    team, company = _brand_team_and_company()
    # which base mailbox actually sends (the brand's connected account)
    base_email = None
    try:
        base_email = _base_mailbox_email()
    except Exception:
        pass
    return {
        "personas": [
            {
                "name": p.get("name"),
                "email": p.get("email"),
                "title": p.get("title", ""),
                "focus": p.get("focus", ""),
            }
            for p in team
        ],
        "base_account": base_email,
        "company": company.get("name", ""),
    }


# ============================================================================
# SENDER PERSONAS (send-as aliases) - non-default brands only
# ============================================================================
#
# A persona is an email_accounts row of the active brand WITHOUT OAuth tokens:
# a "Send mail as" alias on the brand's connected base mailbox (the row that
# holds the refresh_token). config._load_brand_team() turns these rows into the
# brand's persona team for the sender. Brand 1 keeps its personas in
# config/team_config.json, so self-service management is refused there.

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$")
_PERSONA_MAX_DAILY_LIMIT = 2000


class PersonaCreate(BaseModel):
    email: str
    sender_name: str
    sender_title: Optional[str] = None
    persona: Optional[str] = None
    focus_area: Optional[str] = None
    daily_limit: Optional[int] = 50


class PersonaUpdate(BaseModel):
    sender_name: Optional[str] = None
    sender_title: Optional[str] = None
    persona: Optional[str] = None
    focus_area: Optional[str] = None
    daily_limit: Optional[int] = None
    is_active: Optional[bool] = None


def _reject_default_brand(brand_id: str) -> None:
    if brand_catalog.is_default_brand(brand_id):
        raise HTTPException(
            status_code=400,
            detail="Sender personas of the default brand are managed in its team "
                   "configuration (team_config.json), not here.",
        )


def _clean_text(value: Optional[str], field: str, max_len: int, required: bool = False) -> Optional[str]:
    v = (value or "").strip()
    if required and not v:
        raise HTTPException(status_code=400, detail=f"{field} is required")
    if len(v) > max_len:
        raise HTTPException(status_code=400, detail=f"{field} must be at most {max_len} characters")
    return v or None


def _clean_daily_limit(value: Optional[int]) -> int:
    if value is None:
        return 50
    if not isinstance(value, int) or value < 1 or value > _PERSONA_MAX_DAILY_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"daily_limit must be between 1 and {_PERSONA_MAX_DAILY_LIMIT}",
        )
    return value


def _brand_has_base_mailbox(brand_id: str) -> bool:
    rows = execute_sql(
        "SELECT 1 FROM email_accounts WHERE brand_id = %s "
        "AND refresh_token IS NOT NULL AND refresh_token <> '' LIMIT 1",
        [brand_id],
    )
    return bool(rows)


def _invalidate_personas(brand_id: str) -> None:
    try:
        from config import invalidate_brand_config
        invalidate_brand_config(brand_id)
    except Exception as e:  # cache TTL is short; never fail the request on this
        print(f"[email_accounts] persona cache invalidation failed for {brand_id}: {e}")


@router.post("/personas")
async def create_sender_persona(body: PersonaCreate,
                                current_user: dict = Depends(require_permission("accounts.manage"))):
    """Add a sender persona (send-as alias of the brand's base mailbox) to the
    ACTIVE brand. Not available for the default brand."""
    brand_id = tenancy.require_brand()
    _reject_default_brand(brand_id)

    email = (body.email or "").strip().lower()
    if not email or len(email) > 255 or not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    sender_name = _clean_text(body.sender_name, "sender_name", 100, required=True)
    sender_title = _clean_text(body.sender_title, "sender_title", 200)
    persona = _clean_text(body.persona, "persona", 2000)
    focus_area = _clean_text(body.focus_area, "focus_area", 2000)
    daily_limit = _clean_daily_limit(body.daily_limit)

    # email_accounts.email is GLOBALLY unique. Trusted cross-brand existence
    # check only - nothing about another brand's row is returned.
    with system_scope():
        owners = execute_sql(
            "SELECT brand_id FROM email_accounts WHERE lower(email) = lower(%s)",
            [email],
        )
    if owners:
        if any(str(r.get("brand_id")) == str(brand_id) for r in owners):
            raise HTTPException(status_code=400, detail=f"{email} already exists in this brand")
        raise HTTPException(status_code=400, detail="This address is used by another brand")

    if not _brand_has_base_mailbox(brand_id):
        raise HTTPException(status_code=400, detail="Connect the brand's Gmail mailbox first")

    try:
        result = get_supabase().table('email_accounts').insert({
            'email': email,
            'display_name': sender_name,
            'sender_name': sender_name,
            'sender_title': sender_title,
            'persona': persona,
            'focus_area': focus_area,
            'daily_limit': daily_limit,
            'provider': 'gmail',
            'status': 'active',
            'is_active': True,
        }).execute()
    except Exception as e:
        if "email_accounts_email_key" in str(e) or "duplicate key" in str(e).lower():
            raise HTTPException(status_code=400, detail="This address is already in use")
        raise HTTPException(status_code=500, detail=f"Failed to add persona: {str(e)}")
    finally:
        _invalidate_personas(brand_id)

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to add persona")
    return {"success": True, "account": _public_account(result.data[0])}


@router.patch("/personas/{persona_id}")
async def update_sender_persona(persona_id: str, body: PersonaUpdate,
                                current_user: dict = Depends(require_permission("accounts.manage"))):
    """Edit a sender persona of the ACTIVE brand (never a connected mailbox
    row). Not available for the default brand."""
    brand_id = tenancy.require_brand()
    _reject_default_brand(brand_id)

    try:
        uuid.UUID(str(persona_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="Persona not found")

    supabase = get_supabase()
    # auto-scoped to the active brand: another brand's id -> nothing -> 404
    existing = supabase.table('email_accounts')\
        .select('id, refresh_token')\
        .eq('id', persona_id)\
        .execute()
    if not existing.data or existing.data[0].get('refresh_token'):
        raise HTTPException(status_code=404, detail="Persona not found")

    fields = body.model_dump(exclude_unset=True) if hasattr(body, "model_dump") else body.dict(exclude_unset=True)
    updates: dict = {}
    if "sender_name" in fields:
        name = _clean_text(fields["sender_name"], "sender_name", 100, required=True)
        updates["sender_name"] = name
        updates["display_name"] = name
    if "sender_title" in fields:
        updates["sender_title"] = _clean_text(fields["sender_title"], "sender_title", 200)
    if "persona" in fields:
        updates["persona"] = _clean_text(fields["persona"], "persona", 2000)
    if "focus_area" in fields:
        updates["focus_area"] = _clean_text(fields["focus_area"], "focus_area", 2000)
    if "daily_limit" in fields:
        if fields["daily_limit"] is None:
            raise HTTPException(status_code=400, detail="daily_limit cannot be empty")
        updates["daily_limit"] = _clean_daily_limit(fields["daily_limit"])
    if "is_active" in fields:
        if fields["is_active"] is None:
            raise HTTPException(status_code=400, detail="is_active cannot be empty")
        updates["is_active"] = bool(fields["is_active"])
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = datetime.utcnow().isoformat()

    try:
        result = supabase.table('email_accounts')\
            .update(updates)\
            .eq('id', persona_id)\
            .execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update persona: {str(e)}")
    finally:
        _invalidate_personas(brand_id)

    if not result.data:
        raise HTTPException(status_code=404, detail="Persona not found")
    return {"success": True, "account": _public_account(result.data[0])}


@router.get("/{account_id}")
async def get_account_details(account_id: str, current_user: dict = Depends(require_permission("accounts.view"))):
    """
    Get detailed information about a specific email account

    Returns:
    - Account details
    - Detailed sending history
    - Engagement metrics
    - Recent emails sent
    """
    try:
        supabase = get_supabase()

        # Get account
        account = supabase.table('email_accounts')\
            .select('*')\
            .eq('id', account_id)\
            .execute()

        if not account.data or len(account.data) == 0:
            raise HTTPException(status_code=404, detail="Account not found")

        account_data = _public_account(account.data[0])

        # Get recent emails from this account (last 20)
        recent_emails = supabase.table('sent_emails')\
            .select('*')\
            .eq('email_account_id', account_id)\
            .order('sent_at', desc=True)\
            .limit(20)\
            .execute()

        # Get daily sending history (last 30 days)
        daily_history = []
        for i in range(30):
            day_start = (datetime.utcnow() - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = day_start + timedelta(days=1)

            day_emails = supabase.table('sent_emails')\
                .select('id', count='exact')\
                .eq('email_account_id', account_id)\
                .gte('sent_at', day_start.isoformat())\
                .lt('sent_at', day_end.isoformat())\
                .execute()

            daily_history.append({
                "date": day_start.strftime('%Y-%m-%d'),
                "sent": len(day_emails.data) if day_emails.data else 0
            })

        daily_history.reverse()  # Show oldest to newest

        return {
            "account": account_data,
            "recent_emails": recent_emails.data or [],
            "daily_history": daily_history
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get account details: {str(e)}")


@router.put("/{account_id}/status")
async def update_account_status(account_id: str, status_data: dict,
                                current_user: dict = Depends(require_permission("accounts.manage"))):
    """
    Update account status (active/paused/blocked)

    Body: {"status": "active" | "paused" | "blocked"}
    """
    try:
        supabase = get_supabase()

        new_status = status_data.get('status')
        if not new_status:
            raise HTTPException(status_code=400, detail="Status is required")

        if new_status not in ['active', 'paused', 'blocked', 'warning']:
            raise HTTPException(status_code=400, detail="Invalid status")

        # Auto-scoped to the active brand: another brand's (or an unknown)
        # id updates nothing -> 404.
        result = supabase.table('email_accounts')\
            .update({"status": new_status})\
            .eq('id', account_id)\
            .execute()

        if not result.data:
            raise HTTPException(status_code=404, detail="Account not found")

        return {
            "success": True,
            "account_id": account_id,
            "new_status": new_status
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update status: {str(e)}")




# ============================================================================
# GOOGLE OAUTH ENDPOINTS
# ============================================================================

def get_google_oauth_flow(redirect_uri: str) -> Flow:
    """Create Google OAuth Flow"""
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(
            status_code=400,
            detail="Google OAuth not configured. Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your environment."
        )

    client_config = {
        "web": {
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [redirect_uri]
        }
    }

    flow = Flow.from_client_config(
        client_config,
        scopes=GMAIL_SCOPES,
        redirect_uri=redirect_uri
    )
    return flow


def _request_host(request: Request) -> str:
    return (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").split(",")[0].strip()


def _brand_return_base(request: Request, brand_id: str) -> str | None:
    """When the flow is started from one of the brand's DEDICATED hostnames,
    send the browser back there after the callback (its session lives on that
    origin). None -> the callback uses the configured frontend URL as before."""
    host = _request_host(request)
    if not host:
        return None
    brand = brand_catalog.get_brand(brand_id) or {}
    if host.split(":")[0].lower() not in (brand.get("hostnames") or []):
        return None
    scheme = (request.headers.get("x-forwarded-proto") or "https").split(",")[0].strip() or "https"
    return f"{scheme}://{host}"


def _mint_oauth_state(brand_id: str, user_id: str, return_base: str | None = None) -> str:
    """Short-lived signed OAuth state carrying the brand + initiating user.

    Never a raw brand id: the public callback trusts only what this signature
    covers. No `sub` claim, so it can never be replayed as an access token
    (get_current_user rejects tokens without a subject).
    """
    now = datetime.now(timezone.utc)
    payload = {
        "purpose": _OAUTH_STATE_PURPOSE,
        "brand": str(brand_id),
        "uid": str(user_id),
        "iat": now,
        "exp": now + _OAUTH_STATE_TTL,
        "nonce": _secrets.token_urlsafe(12),
    }
    if return_base:
        payload["ret"] = return_base
    return pyjwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def _verify_oauth_state(state: str | None) -> dict | None:
    """Claims of a valid, unexpired gmail_oauth state; None otherwise."""
    if not state:
        return None
    try:
        claims = pyjwt.decode(
            state, get_jwt_secret(), algorithms=[JWT_ALGORITHM],
            options={"require": ["exp", "iat"]},
        )
    except pyjwt.PyJWTError:
        return None
    if claims.get("purpose") != _OAUTH_STATE_PURPOSE or "sub" in claims:
        return None
    if not claims.get("brand") or not claims.get("uid"):
        return None
    return claims


def _state_user_may_connect(claims: dict) -> bool:
    """Re-check (at callback time) that the initiating user is still active and
    may manage mailboxes in the brand named by the state."""
    rows = execute_sql(
        "SELECT id, is_active, is_platform_admin FROM sales_reps WHERE id::text = %s",
        [claims["uid"]],
    )
    if not rows or rows[0].get("is_active") is False:
        return False
    user = rows[0]
    try:
        resolved = resolve_user_brand(user, claims["brand"], None)
    except HTTPException:
        return False
    if str(resolved["brand"]["id"]) != str(claims["brand"]):
        return False
    return bool(user.get("is_platform_admin")) or has_permission(resolved["role"], "accounts.manage")


@router.get("/google/auth")
async def google_auth_start(request: Request, current_user: dict = Depends(require_permission("accounts.manage"))):
    """
    Start Google OAuth flow
    Returns the authorization URL to redirect user to Google.
    The mailbox will be connected to the caller's ACTIVE brand.
    """
    try:
        # Build callback URL (must match the redirect URI registered in Google Cloud)
        redirect_uri = get_public_base_url(request) + "/api/email-accounts/google/callback"

        flow = get_google_oauth_flow(redirect_uri)

        brand_id = tenancy.require_brand()
        signed_state = _mint_oauth_state(
            brand_id, current_user["id"], _brand_return_base(request, brand_id)
        )

        authorization_url, state = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent',
            state=signed_state,
        )

        return {
            "auth_url": authorization_url,
            "state": state
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start OAuth: {str(e)}")


@public_router.get("/google/callback")
async def google_auth_callback(request: Request, code: str = None, error: str = None, state: str = None):
    """
    Handle Google OAuth callback (PUBLIC: Google redirects the browser here).
    Verifies the signed state, exchanges the auth code for tokens and creates /
    refreshes the mailbox inside the brand named by the state.
    """
    claims = _verify_oauth_state(state)
    # Get frontend URL from the signed state (brand-dedicated host) or from
    # the request headers / env as before (works with nginx proxy)
    frontend_url = (claims or {}).get("ret") or get_frontend_url(request)

    try:
        if error:
            # Redirect to frontend with error
            return RedirectResponse(
                url=f"{frontend_url}/email-accounts?error={quote(str(error), safe='')}",
                status_code=302
            )

        if not code:
            return RedirectResponse(
                url=f"{frontend_url}/email-accounts?error=no_code",
                status_code=302
            )

        if not claims:
            # Missing, forged or expired (15 min) state: never guess a brand.
            return RedirectResponse(
                url=f"{frontend_url}/email-accounts?error=invalid_state",
                status_code=302
            )

        if not _state_user_may_connect(claims):
            return RedirectResponse(
                url=f"{frontend_url}/email-accounts?error=not_allowed",
                status_code=302
            )

        brand_id = str(claims["brand"])

        # Build callback URL (must match the one used in auth start)
        redirect_uri = get_public_base_url(request) + "/api/email-accounts/google/callback"

        flow = get_google_oauth_flow(redirect_uri)

        # Exchange code for tokens
        flow.fetch_token(code=code)
        credentials = flow.credentials

        # Get user info from Google
        service = build('oauth2', 'v2', credentials=credentials)
        user_info = service.userinfo().get().execute()

        email = user_info.get('email')
        if not email:
            return RedirectResponse(
                url=f"{frontend_url}/email-accounts?error=no_email",
                status_code=302
            )
        name = user_info.get('name', email.split('@')[0])

        # A mailbox belongs to exactly one brand (email_accounts.email is
        # globally unique). Trusted cross-brand lookup of the owner only.
        with system_scope():
            owners = execute_sql(
                "SELECT brand_id FROM email_accounts WHERE lower(email) = lower(%s)",
                [email],
            )
        if any(str(r.get("brand_id")) != brand_id for r in owners):
            print(f"OAuth callback: refused {email!r} - mailbox belongs to another brand")
            return RedirectResponse(
                url=f"{frontend_url}/email-accounts?error=mailbox_in_other_brand",
                status_code=302
            )

        # Prepare token expiry (credentials.expiry might not exist)
        token_expiry = None
        if hasattr(credentials, 'expiry') and credentials.expiry:
            token_expiry = credentials.expiry.isoformat()

        with brand_scope(brand_id):
            # Store in database (auto-scoped to the state's brand)
            supabase = get_supabase()

            # Check if account already exists
            existing = supabase.table('email_accounts')\
                .select('id')\
                .eq('email', email)\
                .execute()

            if existing.data and len(existing.data) > 0:
                # Update existing account with new tokens
                supabase.table('email_accounts')\
                    .update({
                        'access_token': credentials.token,
                        'refresh_token': credentials.refresh_token,
                        'token_expires_at': token_expiry,
                        'status': 'active',
                        'updated_at': datetime.utcnow().isoformat()
                    })\
                    .eq('email', email)\
                    .execute()

                return RedirectResponse(
                    url=f"{frontend_url}/email-accounts?success=updated&email={email}",
                    status_code=302
                )
            else:
                # Create new account
                supabase.table('email_accounts').insert({
                    'email': email,
                    'display_name': name,
                    'sender_name': name,
                    'sender_title': 'Team Member',
                    'persona': 'professional',
                    'focus_area': 'general',
                    'access_token': credentials.token,
                    'refresh_token': credentials.refresh_token,
                    'token_expires_at': token_expiry,
                    'daily_limit': 50,
                    'status': 'active',
                    'health_score': 1.00,
                    'provider': 'gmail'
                }).execute()

                return RedirectResponse(
                    url=f"{frontend_url}/email-accounts?success=connected&email={email}",
                    status_code=302
                )

    except Exception as e:
        print(f"OAuth callback error: {str(e)}")
        return RedirectResponse(
            url=f"{frontend_url}/email-accounts?error=callback_failed",
            status_code=302
        )


@router.delete("/google/{account_id}")
async def disconnect_google_account(account_id: str,
                                    current_user: dict = Depends(require_permission("accounts.manage"))):
    """
    Disconnect a Google account (remove OAuth tokens)
    """
    try:
        supabase = get_supabase()

        # Get the account (auto-scoped: another brand's id -> 404)
        account = supabase.table('email_accounts')\
            .select('id')\
            .eq('id', account_id)\
            .execute()

        if not account.data or len(account.data) == 0:
            raise HTTPException(status_code=404, detail="Account not found")

        # Delete the account (scoped; nothing deleted -> 404)
        deleted = supabase.table('email_accounts')\
            .delete()\
            .eq('id', account_id)\
            .execute()

        if not deleted.data:
            raise HTTPException(status_code=404, detail="Account not found")

        return {
            "success": True,
            "message": "Account disconnected successfully"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to disconnect: {str(e)}")
