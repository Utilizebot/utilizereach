"""
Google Analytics 4 integration (one read-only GA4 connection per brand).

    GET    /api/integrations/google-analytics/status      analytics.view
    GET    /api/integrations/google-analytics/auth        settings.manage  -> {auth_url}
    GET    /api/integrations/google-analytics/callback    PUBLIC (Google redirects the browser here)
    POST   /api/integrations/google-analytics/connect     settings.manage  (finishes the sign-in)
    GET    /api/integrations/google-analytics/properties  settings.manage
    PUT    /api/integrations/google-analytics/settings    settings.manage
    DELETE /api/integrations/google-analytics             settings.manage
    GET    /api/integrations/google-analytics/realtime    analytics.view
    GET    /api/integrations/google-analytics/summary     analytics.view  (?days=1|7|28|30|90)

The provider logic (OAuth, GA Admin/Data API calls, parsing, error mapping,
caching) lives in integrations/google_analytics.py; this module owns the
brand's stored connection: one brand_integrations row per brand
(provider = 'google_analytics').

Multi-brand (docs/MULTIBRAND.md):
  * every endpoint on `router` runs in an authenticated request bound to the
    caller's active brand; raw SQL on brand_integrations always carries an
    explicit `brand_id = %s`;
  * the OAuth callback is public and lives on `public_router`. The brand and
    the initiating user travel through Google inside a short-lived signed
    `state` (purpose "ga_oauth" - a Gmail state can never be replayed here,
    and vice versa). The callback re-checks that the user is still active and
    may settings.manage in that brand, but it does NOT store anything: the
    state is a bearer value (anyone holding the consent link could finish
    it), so the sign-in is bound to the initiating user's own session. The
    callback hands the browser an encrypted, 10-minute "connect ticket" in
    the URL fragment, and only POST /connect - authenticated, in the brand
    named by the ticket, as the user who started the flow - saves it;
  * the GA cache is keyed by brand id first;
  * Google calls run on their own small thread limiter, never on the shared
    worker pool every other endpoint uses.

Secrets: the refresh token is never returned by any endpoint and never
logged; it only leaves the server encrypted inside the connect ticket. Every
row goes through serialize_status() before leaving the API.
"""

from __future__ import annotations

import base64
import functools
import hashlib
import hmac
import json
import logging
import re
import secrets as _secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Optional
from urllib.parse import urlencode

import anyio
import jwt as pyjwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from api.dependencies import require_permission, resolve_user_brand
from api.permissions import has_permission, has_permission_for
from api.routers.email_accounts import _brand_return_base, get_frontend_url, get_public_base_url
from api.security import JWT_ALGORITHM, get_jwt_secret
from database import brands as brand_catalog
from database import tenancy
from database.pg import execute_sql
from database.tenancy import system_scope
from integrations import google_analytics as ga
from integrations.google_analytics import GAError

log = logging.getLogger(__name__)

PREFIX = "/api/integrations/google-analytics"
CALLBACK_PATH = PREFIX + "/callback"
SETTINGS_PAGE = "/settings/integrations"

router = APIRouter(prefix=PREFIX, tags=["Integrations: Google Analytics"])
# Public (no JWT) routes: only the Google OAuth redirect target.
public_router = APIRouter(prefix=PREFIX, tags=["Integrations: Google Analytics"])

PROVIDER = ga.PROVIDER

# Built-in utm_source of the default brand's sender (ops/smart_sender.py,
# UTM_SOURCE fallback) - KEEP IN SYNC. Other brands fall back to their slug.
_DEFAULT_BRAND_UTM_SOURCE = "utilizereach-outreach"

_MAX_SOURCE_LEN = 100
_MAX_PROPERTY_NAME_LEN = 200
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")

# HTTP status for errors raised by the action endpoints (/properties, /settings).
_HTTP_STATUS = {
    ga.NOT_CONFIGURED: 400,
    ga.NOT_CONNECTED: 400,
    ga.INVALID_PROPERTY: 400,
    ga.API_DISABLED: 400,
    ga.PERMISSION_DENIED: 403,
    ga.RECONNECT_REQUIRED: 409,
    ga.QUOTA_EXCEEDED: 429,
    ga.UPSTREAM_ERROR: 502,
}

# Errors worth remembering on the row so Settings can show them.
_PERSISTED_ERRORS = frozenset({ga.RECONNECT_REQUIRED, ga.API_DISABLED, ga.PERMISSION_DENIED,
                               ga.INVALID_PROPERTY, ga.NOT_CONFIGURED})

_HIDDEN_MESSAGE = ("Website analytics are switched off for this brand's dashboard. "
                   "A brand admin can switch them on in Settings -> Integrations.")


# ============================================================================
# Google calls run on their own thread limiter
# ============================================================================

# A slow Google can hold a thread for ~20 s (token refresh + one report round
# trip). Running those calls on AnyIO's default limiter (shared by every
# run_in_threadpool / sync endpoint of every brand) could let open dashboards
# starve the rest of the API, so GA gets its own small one.
_GA_MAX_THREADS = 8
_ga_limiter: Optional[anyio.CapacityLimiter] = None


def _limiter() -> anyio.CapacityLimiter:
    # Created lazily: AnyIO 3 can only build a limiter inside the event loop.
    global _ga_limiter
    if _ga_limiter is None:
        _ga_limiter = anyio.CapacityLimiter(_GA_MAX_THREADS)
    return _ga_limiter


async def _in_ga_thread(fn: Callable[..., Any], *args: Any) -> Any:
    return await anyio.to_thread.run_sync(functools.partial(fn, *args), limiter=_limiter())


# ============================================================================
# Signed OAuth state (purpose "ga_oauth")
# ============================================================================

_STATE_PURPOSE = "ga_oauth"
_STATE_TTL = timedelta(minutes=15)


def mint_state(brand_id: str, user_id: str, return_base: Optional[str] = None) -> str:
    """Short-lived signed state carrying the brand + initiating user.

    No `sub` claim, so it can never be used as an access token, and its
    purpose differs from the Gmail flow's so the two callbacks cannot accept
    each other's states.
    """
    now = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "purpose": _STATE_PURPOSE,
        "brand": str(brand_id),
        "uid": str(user_id),
        "iat": now,
        "exp": now + _STATE_TTL,
        "nonce": _secrets.token_urlsafe(12),
    }
    if return_base:
        payload["ret"] = return_base
    return pyjwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def verify_state(state: Optional[str]) -> Optional[dict]:
    """Claims of a valid, unexpired ga_oauth state; None otherwise."""
    if not state:
        return None
    try:
        claims = pyjwt.decode(
            state, get_jwt_secret(), algorithms=[JWT_ALGORITHM],
            options={"require": ["exp", "iat"]},
        )
    except pyjwt.PyJWTError:
        return None
    if claims.get("purpose") != _STATE_PURPOSE or "sub" in claims:
        return None
    if not claims.get("brand") or not claims.get("uid"):
        return None
    return claims


# ============================================================================
# Connect ticket (callback -> browser -> POST /connect)
# ============================================================================

_TICKET_PURPOSE = "ga_connect"
_TICKET_TTL_SECONDS = 600
_TICKET_MAX_LEN = 4096
_TICKET_KEY_INFO = b"utilizereach/google-analytics/connect-ticket/v1"


def _ticket_cipher():
    """Fernet (AES-128-CBC + HMAC-SHA256) keyed from the server's JWT secret
    with a purpose label, so the key is never the JWT signing key itself."""
    from cryptography.fernet import Fernet

    key = hmac.new(get_jwt_secret().encode("utf-8"), _TICKET_KEY_INFO, hashlib.sha256).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def mint_connect_ticket(brand_id: str, user_id: str, refresh_token: str, email: Optional[str]) -> str:
    """Encrypted, timestamped hand-over of a finished Google sign-in. Opaque
    to the browser (it carries the refresh token, encrypted); only POST
    /connect, as `user_id` in `brand_id`, can redeem it."""
    payload = {"purpose": _TICKET_PURPOSE, "brand": str(brand_id), "uid": str(user_id),
               "rt": refresh_token, "email": email or None}
    return _ticket_cipher().encrypt(json.dumps(payload, separators=(",", ":")).encode("utf-8")).decode("ascii")


def open_connect_ticket(ticket: Any) -> Optional[dict]:
    """The ticket's content if it is ours, intact and younger than 10 minutes."""
    if not isinstance(ticket, str) or not ticket or len(ticket) > _TICKET_MAX_LEN:
        return None
    try:
        data = json.loads(_ticket_cipher().decrypt(ticket.strip().encode("ascii"), ttl=_TICKET_TTL_SECONDS))
    except Exception:  # InvalidToken (tampered, expired, other key), bad encoding, bad JSON
        return None
    if not isinstance(data, dict) or data.get("purpose") != _TICKET_PURPOSE:
        return None
    if not data.get("brand") or not data.get("uid") or not data.get("rt"):
        return None
    return data


def _state_user_may_manage(claims: dict) -> bool:
    """Re-check at callback time that the initiating user is still active and
    may manage settings (settings.manage) in the brand named by the state."""
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
    return bool(user.get("is_platform_admin")) or has_permission(resolved["role"], "settings.manage")


# ============================================================================
# The brand's connection row (tenant table brand_integrations)
# ============================================================================

_ROW_COLUMNS = ("id, brand_id, provider, config, refresh_token, account_email, status, "
                "last_error, connected_by, created_at, updated_at")


def _load_row(brand_id: str) -> Optional[dict]:
    rows = execute_sql(
        f"SELECT {_ROW_COLUMNS} FROM brand_integrations WHERE brand_id = %s AND provider = %s",
        [brand_id, PROVIDER],
    )
    return rows[0] if rows else None


def _update_row(brand_id: str, fields: Dict[str, Any]) -> None:
    if not fields:
        return
    sets, params = [], []
    for col, val in fields.items():
        sets.append(f"{col} = %s")
        params.append(Jsonb(val) if isinstance(val, dict) else val)
    execute_sql(
        f"UPDATE brand_integrations SET {', '.join(sets)}, updated_at = NOW() "
        "WHERE brand_id = %s AND provider = %s",
        params + [brand_id, PROVIDER],
    )


def normalize_config(row: Optional[dict]) -> Dict[str, Any]:
    raw = (row or {}).get("config")
    cfg = raw if isinstance(raw, dict) else {}
    pid = str(cfg.get("property_id") or "").strip()
    show = cfg.get("show_on_dashboard")
    return {
        "property_id": pid if ga.PROPERTY_ID_RE.match(pid) else None,
        "property_name": (str(cfg.get("property_name")).strip() or None) if cfg.get("property_name") else None,
        "highlight_source": (str(cfg.get("highlight_source")).strip() or None)
        if cfg.get("highlight_source") else None,
        "show_on_dashboard": True if show is None else bool(show),
    }


def default_highlight_source(brand: Optional[dict]) -> str:
    """The utm_source the brand's sender actually tags links with:
    brands.sender.utm_source, else the sender's own fallback."""
    if not brand:
        return ""
    fallback = _DEFAULT_BRAND_UTM_SOURCE if brand_catalog.is_default_brand(brand) else (brand.get("slug") or "")
    value = brand_catalog.sender_value(brand, "utm_source", None, fallback, env_for_all_brands=False)
    return str(value or "").strip()[:_MAX_SOURCE_LEN]


def connection_status(row: Optional[dict]) -> str:
    if not row:
        return "not_connected"
    if not row.get("refresh_token") or (row.get("status") or "connected") != "connected":
        return "reconnect_required"
    return "connected"


def serialize_status(row: Optional[dict], brand: Optional[dict], can_manage: bool,
                     configured: bool, redirect_uri: Optional[str] = None) -> Dict[str, Any]:
    """The ONLY shape a connection row leaves the API in (no refresh token)."""
    cfg = normalize_config(row)
    status = connection_status(row)
    default_source = default_highlight_source(brand)
    out: Dict[str, Any] = {
        "configured": bool(configured),
        "connected": status == "connected",
        "status": status,
        "account_email": (row or {}).get("account_email") or None,
        "property_id": cfg["property_id"],
        "property_name": cfg["property_name"],
        "highlight_source": cfg["highlight_source"] or default_source or None,
        "default_highlight_source": default_source or None,
        "show_on_dashboard": cfg["show_on_dashboard"],
        "last_error": (row or {}).get("last_error") or None,
        "can_manage": bool(can_manage),
    }
    if can_manage and redirect_uri:
        # what an admin registers as "Authorized redirect URI" in Google Cloud
        out["redirect_uri"] = redirect_uri
    return out


def _effective_source(row: Optional[dict], brand: Optional[dict]) -> str:
    return normalize_config(row)["highlight_source"] or default_highlight_source(brand)


def _gate(row: Optional[dict]) -> Optional[GAError]:
    """Why GA cannot be queried for this row right now (None = go)."""
    if not ga.is_configured():
        return GAError(ga.NOT_CONFIGURED)
    status = connection_status(row)
    if status == "not_connected":
        return GAError(ga.NOT_CONNECTED)
    if status == "reconnect_required":
        return GAError(ga.RECONNECT_REQUIRED)
    if not normalize_config(row)["property_id"]:
        return GAError(ga.INVALID_PROPERTY, "No Google Analytics property is selected yet. "
                                            "An admin can pick one in Settings -> Integrations.")
    return None


def _record_error(brand_id: str, row: Optional[dict], err: GAError) -> None:
    """Remember a lasting error on the row (status reconnect_required for a
    dead grant). Only writes when something changes. Never raises."""
    if not row or err.code not in _PERSISTED_ERRORS:
        return
    fields: Dict[str, Any] = {}
    if err.code == ga.RECONNECT_REQUIRED and row.get("status") != "reconnect_required":
        fields["status"] = "reconnect_required"
    if row.get("last_error") != err.message:
        fields["last_error"] = err.message
    try:
        _update_row(brand_id, fields)
    except Exception as e:
        log.warning("GA: could not record error for brand %s: %s", brand_id, type(e).__name__)
    if err.code == ga.RECONNECT_REQUIRED:
        ga.invalidate_brand(brand_id)


def _clear_error(brand_id: str, row: Optional[dict]) -> None:
    if row and row.get("last_error") and connection_status(row) == "connected":
        try:
            _update_row(brand_id, {"last_error": None})
        except Exception as e:
            log.warning("GA: could not clear error for brand %s: %s", brand_id, type(e).__name__)


def _http_error(err: GAError) -> HTTPException:
    return HTTPException(status_code=_HTTP_STATUS.get(err.code, 502), detail=err.message)


def _redirect_uri(request: Request) -> str:
    return get_public_base_url(request) + CALLBACK_PATH


def _properties_key(brand_id: str, row: dict) -> tuple:
    return (str(brand_id), "properties", None, (row.get("account_email") or "").lower())


def _fetch_properties(brand_id: str, row: dict):
    """(properties, cached) for the brand's connected account; GAError on failure."""
    token = row.get("refresh_token")

    def fetch():
        with ga.authorized_session(token, brand_id) as session:
            return ga.list_properties(session)

    # a transient error with an older list cached -> that list (good enough for a picker)
    value, cached, _err = ga.cached(_properties_key(brand_id, row), ga.PROPERTIES_TTL, fetch)
    return value, cached


# ============================================================================
# Endpoints
# ============================================================================

@router.get("/status")
async def ga_status(request: Request, current_user: dict = Depends(require_permission("analytics.view"))):
    """The brand's Google Analytics connection (never includes the token)."""
    brand_id = tenancy.require_brand()
    row = _load_row(brand_id)
    can_manage = has_permission_for(current_user, "settings.manage")
    return serialize_status(row, brand_catalog.get_brand(brand_id), can_manage, ga.is_configured(),
                            _redirect_uri(request) if can_manage else None)


@router.get("/auth")
async def ga_auth_start(request: Request, current_user: dict = Depends(require_permission("settings.manage"))):
    """Google consent URL. The connection is made for the caller's ACTIVE brand."""
    if not ga.is_configured():
        raise _http_error(GAError(ga.NOT_CONFIGURED))
    brand_id = tenancy.require_brand()
    state = mint_state(brand_id, current_user["id"], _brand_return_base(request, brand_id))
    try:
        flow = ga.build_oauth_flow(_redirect_uri(request))
        return {"auth_url": ga.authorization_url(flow, state)}
    except GAError as e:
        raise _http_error(e)
    except Exception as e:
        log.warning("GA: could not build the consent URL: %s", type(e).__name__)
        raise HTTPException(status_code=500, detail="Could not start the Google sign-in.")


def _callback_redirect(base: str, fragment: Optional[Dict[str, str]] = None, **params: str) -> RedirectResponse:
    url = f"{base}{SETTINGS_PAGE}?{urlencode(params)}"
    if fragment:
        # The fragment never reaches any server (not ours, not a proxy log,
        # not a Referer header); the SPA reads it and removes it at once.
        url += "#" + urlencode(fragment)
    return RedirectResponse(url=url, status_code=302)


_GOOGLE_ERRORS = {"access_denied": "access_denied"}


@public_router.get("/callback")
async def ga_auth_callback(request: Request, code: Optional[str] = None, error: Optional[str] = None,
                           state: Optional[str] = None):
    """PUBLIC: Google redirects the browser here after consent.

    Verifies the signed state, re-checks the initiating user and exchanges
    the code - but stores nothing. The state is a bearer value: whoever opens
    the consent link can complete it, so a link forwarded to someone outside
    the brand must not connect THEIR Google account to the brand. The result
    goes back to the browser as an encrypted connect ticket in the URL
    fragment (?ga=confirm#ga_ticket=...), and only POST /connect, made by the
    initiating user in that brand, saves it. Failures redirect with
    ?ga_error=<code>.
    """
    claims = verify_state(state)
    frontend = (claims or {}).get("ret") or get_frontend_url(request)

    def fail(code_: str) -> RedirectResponse:
        return _callback_redirect(frontend, ga_error=code_)

    try:
        if error:
            return fail(_GOOGLE_ERRORS.get(str(error).strip().lower(), "oauth_error"))
        if not code:
            return fail("no_code")
        if not claims:
            # missing, forged, expired (15 min) or another flow's state: never guess a brand
            return fail("invalid_state")
        if not _state_user_may_manage(claims):
            return fail("not_allowed")
        if not ga.is_configured():
            return fail(ga.NOT_CONFIGURED)

        brand_id = str(claims["brand"])
        try:
            tokens = await _in_ga_thread(ga.exchange_code, _redirect_uri(request), code)
        except GAError as e:
            return fail(ga.NOT_CONFIGURED if e.code == ga.NOT_CONFIGURED else "exchange_failed")
        if ga.ANALYTICS_SCOPE not in tokens.get("scopes", []):
            return fail("scope_missing")
        refresh_token = tokens.get("refresh_token")
        if not refresh_token:
            return fail("no_refresh_token")
        email = (tokens.get("email") or "").strip() or None

        ticket = mint_connect_ticket(brand_id, str(claims["uid"]), refresh_token, email)
        log.info("GA sign-in finished for brand %s; waiting for the initiating admin to confirm", brand_id)
        return _callback_redirect(frontend, fragment={"ga_ticket": ticket}, ga="confirm")
    except Exception as e:
        log.warning("GA OAuth callback failed: %s", type(e).__name__)
        return fail("callback_failed")


class GAConnectBody(BaseModel):
    ticket: str


_TICKET_REFUSED = ("This Google sign-in cannot be finished here: it is older than 10 minutes, or it was "
                   "started by another user or for another brand. Click Connect to start again.")


@router.post("/connect")
async def ga_connect(body: GAConnectBody, request: Request,
                     current_user: dict = Depends(require_permission("settings.manage"))):
    """Finish a Google sign-in: save the connect ticket the callback handed
    to the browser. Only the admin who started the flow, in the brand it was
    started for, can redeem it (10 minutes). Returns the status object."""
    brand_id = tenancy.require_brand()
    data = open_connect_ticket(body.ticket)
    if (not data or str(data["brand"]) != str(brand_id)
            or str(data["uid"]) != str(current_user.get("id") or "")):
        raise HTTPException(status_code=400, detail=_TICKET_REFUSED)
    if not ga.is_configured():
        raise _http_error(GAError(ga.NOT_CONFIGURED))
    refresh_token = str(data["rt"])
    email = (str(data.get("email") or "")).strip() or None

    existing = _load_row(brand_id)
    config = normalize_config(existing)
    if existing and (existing.get("account_email") or "").lower() != (email or "").lower():
        # another Google account sees other properties: keep the
        # highlight + dashboard choices, ask for the property again
        config["property_id"] = None
        config["property_name"] = None
    execute_sql(
        "INSERT INTO brand_integrations "
        "(brand_id, provider, config, refresh_token, account_email, status, last_error, connected_by) "
        "VALUES (%s, %s, %s, %s, %s, 'connected', NULL, %s) "
        "ON CONFLICT (brand_id, provider) DO UPDATE SET "
        "config = EXCLUDED.config, refresh_token = EXCLUDED.refresh_token, "
        "account_email = EXCLUDED.account_email, status = 'connected', last_error = NULL, "
        "connected_by = EXCLUDED.connected_by, updated_at = NOW() "
        "RETURNING id",
        [brand_id, PROVIDER, Jsonb(config), refresh_token, email, str(current_user["id"])],
    )
    ga.invalidate_brand(brand_id)

    # Convenience: an account that can read exactly one property gets it
    # selected right away. Best effort - errors surface in the picker.
    if not config["property_id"]:
        row = _load_row(brand_id)
        try:
            props, _ = await _in_ga_thread(_fetch_properties, brand_id, row)
        except GAError:
            props = []
        if len(props) == 1:
            config["property_id"] = props[0]["property_id"]
            config["property_name"] = props[0]["display_name"]
            _update_row(brand_id, {"config": config})

    log.info("GA connected for brand %s", brand_id)
    return serialize_status(_load_row(brand_id), brand_catalog.get_brand(brand_id), True,
                            ga.is_configured(), _redirect_uri(request))


@router.get("/properties")
async def ga_properties(current_user: dict = Depends(require_permission("settings.manage"))):
    """GA4 properties the connected Google account can read."""
    brand_id = tenancy.require_brand()
    row = _load_row(brand_id)
    if not ga.is_configured():
        raise _http_error(GAError(ga.NOT_CONFIGURED))
    status = connection_status(row)
    if status != "connected":
        raise _http_error(GAError(ga.NOT_CONNECTED if status == "not_connected" else ga.RECONNECT_REQUIRED))
    try:
        props, cached = await _in_ga_thread(_fetch_properties, brand_id, row)
    except GAError as e:
        _record_error(brand_id, row, e)
        raise _http_error(e)
    return {"properties": props, "cached": cached}


class GASettingsUpdate(BaseModel):
    property_id: Optional[str] = None
    property_name: Optional[str] = None
    highlight_source: Optional[str] = None
    show_on_dashboard: Optional[bool] = None


def _clean_text(value: Any, field: str, max_len: int) -> Optional[str]:
    v = str(value or "").strip()
    if _CONTROL_RE.search(v):
        raise HTTPException(status_code=400, detail=f"{field} contains invalid characters")
    if len(v) > max_len:
        raise HTTPException(status_code=400, detail=f"{field} must be at most {max_len} characters")
    return v or None


def validate_property_id(value: Any) -> Optional[str]:
    """'' / None -> None (clear). Otherwise digits only, 1-20 of them."""
    v = str(value or "").strip()
    if not v:
        return None
    if not ga.PROPERTY_ID_RE.match(v):
        raise HTTPException(status_code=400,
                            detail="property_id must be the numeric GA4 property ID (digits only).")
    return v


@router.put("/settings")
async def ga_update_settings(body: GASettingsUpdate, request: Request,
                             current_user: dict = Depends(require_permission("settings.manage"))):
    """Pick the GA4 property, the utm_source to highlight and the dashboard toggle."""
    brand_id = tenancy.require_brand()
    row = _load_row(brand_id)
    if not row:
        raise HTTPException(status_code=400, detail="Connect a Google account first.")
    fields = body.model_dump(exclude_unset=True) if hasattr(body, "model_dump") else body.dict(exclude_unset=True)
    config = normalize_config(row)
    changed_property = False

    if "property_id" in fields:
        pid = validate_property_id(fields["property_id"])
        name = _clean_text(fields.get("property_name"), "property_name", _MAX_PROPERTY_NAME_LEN)
        if pid and pid == config["property_id"]:
            name = name or config["property_name"]
        elif pid and connection_status(row) == "connected" and ga.is_configured():
            # Make sure the connected account can read it (and learn its name).
            # If Google cannot be asked right now, accept it: the dashboard
            # cards will report a permission problem if there is one.
            try:
                props, _ = await _in_ga_thread(_fetch_properties, brand_id, row)
            except GAError as e:
                props = None
                if e.code == ga.RECONNECT_REQUIRED:
                    _record_error(brand_id, row, e)
            if props is not None:
                match = next((p for p in props if p["property_id"] == pid), None)
                if not match:
                    raise HTTPException(
                        status_code=400,
                        detail=f"The connected Google account cannot read GA4 property {pid}. "
                               "Pick one from the list.")
                name = name or match["display_name"]
        changed_property = pid != config["property_id"]
        config["property_id"] = pid
        config["property_name"] = name if pid else None
    elif "property_name" in fields and config["property_id"]:
        config["property_name"] = _clean_text(fields["property_name"], "property_name", _MAX_PROPERTY_NAME_LEN)

    if "highlight_source" in fields:
        config["highlight_source"] = _clean_text(fields["highlight_source"], "highlight_source", _MAX_SOURCE_LEN)
    if "show_on_dashboard" in fields and fields["show_on_dashboard"] is not None:
        config["show_on_dashboard"] = bool(fields["show_on_dashboard"])

    update: Dict[str, Any] = {"config": config}
    if changed_property and connection_status(row) == "connected":
        update["last_error"] = None  # it was about the previous property
    _update_row(brand_id, update)
    ga.invalidate_brand(brand_id)

    can_manage = has_permission_for(current_user, "settings.manage")
    return serialize_status(_load_row(brand_id), brand_catalog.get_brand(brand_id), can_manage,
                            ga.is_configured(), _redirect_uri(request))


def _google_account_shared(email: Optional[str], brand_id: str) -> bool:
    """True when revoking this Google account's grant could break something
    else on this deployment: Google revokes the whole grant of the (shared)
    OAuth client, so a mailbox connected with the same account - in any brand
    - or another brand's GA connection would stop working too.

    Trusted cross-brand EXISTENCE check only: nothing about another brand's
    rows is returned (or exposed by the endpoint's answer).
    """
    if not email:
        return True  # unknown account: never risk it
    with system_scope():
        if execute_sql(
            "SELECT 1 FROM email_accounts WHERE lower(email) = lower(%s) "
            "AND refresh_token IS NOT NULL AND refresh_token <> '' LIMIT 1",
            [email],
        ):
            return True
        if execute_sql(
            "SELECT 1 FROM brand_integrations WHERE lower(account_email) = lower(%s) "
            "AND brand_id <> %s AND refresh_token IS NOT NULL AND refresh_token <> '' LIMIT 1",
            [email, brand_id],
        ):
            return True
    try:
        from integrations.brand_mail import GMAIL_TOKENS_FILE, load_legacy_gmail_tokens
        if GMAIL_TOKENS_FILE.is_file():
            legacy = (load_legacy_gmail_tokens().get("GMAIL_EMAIL") or "").strip().lower()
            if not legacy or legacy == email.lower():
                return True
    except Exception:
        return True
    return False


@router.delete("")
@router.delete("/")
async def ga_disconnect(current_user: dict = Depends(require_permission("settings.manage"))):
    """Disconnect: best-effort revoke at Google (skipped when the Google
    account is also used for sending), then delete the brand's row."""
    brand_id = tenancy.require_brand()
    row = _load_row(brand_id)
    if row:
        token = row.get("refresh_token")
        if token:
            if _google_account_shared(row.get("account_email"), brand_id):
                log.info("GA disconnect for brand %s: revoke skipped (Google account in use elsewhere)", brand_id)
            else:
                revoked = await _in_ga_thread(ga.revoke_token, token)
                log.info("GA disconnect for brand %s: revoke %s", brand_id, "ok" if revoked else "failed")
        execute_sql("DELETE FROM brand_integrations WHERE brand_id = %s AND provider = %s", [brand_id, PROVIDER])
    ga.invalidate_brand(brand_id)
    return {"ok": True}


def _dashboard_gate(row: Optional[dict], current_user: dict) -> Optional[GAError]:
    """Why this caller may not load the brand's GA data right now (None = go).

    "Show on dashboard" off hides the data from everyone who cannot manage
    settings - not only in the UI - so a viewer cannot read it by calling the
    endpoint directly. Checked before the cache or Google is touched.
    """
    gate = _gate(row)
    if gate:
        return gate
    if not normalize_config(row)["show_on_dashboard"] and not has_permission_for(current_user, "settings.manage"):
        return GAError(ga.NOT_CONNECTED, _HIDDEN_MESSAGE)
    return None


@router.get("/realtime")
async def ga_realtime(current_user: dict = Depends(require_permission("analytics.view"))):
    """Website live: active users in the last 30 minutes, per minute, top
    pages, countries and devices. Cached 30 s per brand."""
    brand_id = tenancy.require_brand()
    row = _load_row(brand_id)
    cfg = normalize_config(row)
    payload: Dict[str, Any] = {"connected": connection_status(row) == "connected",
                               "property_id": cfg["property_id"]}
    payload.update(ga.empty_realtime())
    payload["cached"] = False

    gate = _dashboard_gate(row, current_user)
    if gate:
        payload["error"] = gate.to_dict()
        return payload

    token, pid = row["refresh_token"], cfg["property_id"]

    def fetch():
        with ga.authorized_session(token, brand_id) as session:
            return ga.fetch_realtime(session, pid)

    try:
        data, cached, err = await _in_ga_thread(ga.cached, (brand_id, "realtime", pid), ga.REALTIME_TTL, fetch)
    except GAError as e:
        _record_error(brand_id, row, e)
        payload["error"] = e.to_dict()
        payload["connected"] = e.code != ga.RECONNECT_REQUIRED
        return payload
    payload.update(data)
    payload["cached"] = cached
    if err is not None:
        payload["error"] = err.to_dict()
    else:
        _clear_error(brand_id, row)
    return payload


@router.get("/summary")
async def ga_summary(days: int = Query(7, description="1, 7, 28, 30 or 90"),
                     current_user: dict = Depends(require_permission("analytics.view"))):
    """Sessions / users / key events for the period, top sources, and the
    "From your email campaigns" panel (sessions whose utm_source is the
    brand's outreach source, by utm_campaign and by sender persona =
    utm_term). Cached 5 min per brand."""
    if days not in ga.ALLOWED_DAYS:
        raise HTTPException(status_code=400,
                            detail=f"days must be one of {', '.join(str(d) for d in ga.ALLOWED_DAYS)}")
    brand_id = tenancy.require_brand()
    row = _load_row(brand_id)
    cfg = normalize_config(row)
    source = _effective_source(row, brand_catalog.get_brand(brand_id))
    payload: Dict[str, Any] = {"connected": connection_status(row) == "connected",
                               "property_id": cfg["property_id"]}
    payload.update(ga.empty_summary(days, source))
    payload["cached"] = False

    gate = _dashboard_gate(row, current_user)
    if gate:
        payload["error"] = gate.to_dict()
        return payload

    token, pid = row["refresh_token"], cfg["property_id"]

    def fetch():
        with ga.authorized_session(token, brand_id) as session:
            return ga.fetch_summary(session, pid, days, source)

    key = (brand_id, "summary", pid, days, source.lower())
    try:
        data, cached, err = await _in_ga_thread(ga.cached, key, ga.SUMMARY_TTL, fetch)
    except GAError as e:
        _record_error(brand_id, row, e)
        payload["error"] = e.to_dict()
        payload["connected"] = e.code != ga.RECONNECT_REQUIRED
        return payload
    payload.update(data)
    payload["cached"] = cached
    if err is not None:
        payload["error"] = err.to_dict()
    else:
        _clear_error(brand_id, row)
    return payload
