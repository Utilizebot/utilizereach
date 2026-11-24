"""
Google Analytics 4 provider (read-only, one connection per brand).

Pure provider code: no FastAPI and no database access. The router
(api/routers/integrations_google_analytics.py) owns each brand's stored
connection (the brand_integrations row) and calls into this module:

    SCOPES, is_configured(), build_oauth_flow(), authorization_url()
    allow_google_scope_union()             process-wide oauthlib setting (see below)
    exchange_code(redirect_uri, code)      -> {refresh_token, scopes, email}
    credentials_from_refresh_token(token)  -> google.oauth2 Credentials
    authorized_session(token, brand_id)    -> AuthorizedSession (10 s timeouts,
                                              access token reused until it expires;
                                              use it as a context manager)
    revoke_token(token)                    -> bool (best effort)
    list_properties(session)               GA Admin API accountSummaries
    fetch_realtime(session, property_id)   GA Data API runRealtimeReport (5 in parallel)
    fetch_summary(session, property_id, days, highlight_source)
                                           GA Data API batchRunReports (batches in parallel)
    fetch_report(session, property_id, days, highlight_source)
                                           the Website analytics page (16 reports, 4 batches)
    GAError(code, message)                 normalised, user-safe errors
    CACHE / cached()                       small in-process TTL cache keyed
                                           by (brand_id, kind, property, ...)
    invalidate_brand(brand_id)             drop a brand's cached data + access token

Secrets: a refresh token only ever travels from the caller into
google.oauth2.credentials.Credentials, the token endpoint or the revoke call.
It is never logged, never put into an exception message, and Google's raw
error text is never passed through to API responses. The in-process
Credentials cache is keyed by (brand_id, sha256(refresh token)), never by
the token itself.

Every HTTP call has a 10 s timeout. Every response is parsed defensively:
GA omits `rows` when a report is empty and sends metric values as strings.
"""

from __future__ import annotations

import copy
import functools
import hashlib
import logging
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, Hashable, List, Optional, Sequence, Tuple
from urllib.parse import quote

import jwt as pyjwt
import requests

log = logging.getLogger(__name__)

PROVIDER = "google_analytics"

ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
SCOPES = [
    ANALYTICS_SCOPE,
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]

AUTH_URI = "https://accounts.google.com/o/oauth2/auth"
TOKEN_URI = "https://oauth2.googleapis.com/token"
REVOKE_URI = "https://oauth2.googleapis.com/revoke"
USERINFO_URI = "https://openidconnect.googleapis.com/v1/userinfo"
ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta"
DATA_API = "https://analyticsdata.googleapis.com/v1beta"

HTTP_TIMEOUT = 10  # seconds, every Google call

PROPERTY_ID_RE = re.compile(r"^[0-9]{1,20}$")
ALLOWED_DAYS = (1, 7, 28, 30, 90)
REALTIME_MINUTES = 30          # standard GA4 properties: minutesAgo 0..29

REALTIME_TTL = 30              # seconds
SUMMARY_TTL = 300
PROPERTIES_TTL = 300
NEGATIVE_TTL = 30              # a transient error is remembered this long (no hammering)
LASTING_ERROR_TTL = 300        # errors only an admin can fix (API off, no access, bad property)
LOCK_WAIT = 2.0                # how long a poller waits for another poller's fetch of the same data

_MAX_BATCH = 5                 # batchRunReports accepts at most 5 requests
_MAX_ADMIN_PAGES = 25
_MAX_PARALLEL = 5              # GA allows 10 concurrent realtime requests per property

# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

NOT_CONNECTED = "not_connected"
NOT_CONFIGURED = "not_configured"
API_DISABLED = "api_disabled"
PERMISSION_DENIED = "permission_denied"
RECONNECT_REQUIRED = "reconnect_required"
QUOTA_EXCEEDED = "quota_exceeded"
INVALID_PROPERTY = "invalid_property"
UPSTREAM_ERROR = "upstream_error"

ERROR_CODES = (NOT_CONNECTED, NOT_CONFIGURED, API_DISABLED, PERMISSION_DENIED, RECONNECT_REQUIRED,
               QUOTA_EXCEEDED, INVALID_PROPERTY, UPSTREAM_ERROR)

_ENABLE_APIS_HINT = (
    'Ask whoever manages this deployment\'s Google Cloud project (the one that owns its '
    'OAuth client) to enable both "Google Analytics Data API" and "Google Analytics Admin API" '
    "under APIs & Services -> Library, wait a few minutes, then try again."
)

DEFAULT_MESSAGES = {
    NOT_CONNECTED: "Google Analytics is not connected for this brand. "
                   "An admin can connect it in Settings -> Integrations.",
    NOT_CONFIGURED: "Google sign-in is not configured on this server "
                    "(GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are missing).",
    API_DISABLED: "The Google Analytics APIs are not enabled for this deployment. " + _ENABLE_APIS_HINT,
    PERMISSION_DENIED: "The connected Google account has no access to this Google Analytics property. "
                       "Give it at least Viewer access in Google Analytics (Admin -> Property access "
                       "management) or pick another property.",
    RECONNECT_REQUIRED: "Google access for this brand has expired or was revoked. "
                        "An admin needs to reconnect Google Analytics in Settings -> Integrations.",
    QUOTA_EXCEEDED: "Google Analytics quota for this property is used up for now. "
                    "Data will refresh automatically when the quota resets.",
    INVALID_PROPERTY: "The selected Google Analytics property is not valid. "
                      "Pick a GA4 property in Settings -> Integrations.",
    UPSTREAM_ERROR: "Google Analytics did not answer as expected. Try again in a minute.",
}

# Transient errors: serve the last good cached value instead (cached: true).
STALE_OK_CODES = frozenset({QUOTA_EXCEEDED, UPSTREAM_ERROR})

# Errors nothing but an admin can fix: remembered for LASTING_ERROR_TTL, so a
# misconfigured brand does not call Google on every dashboard poll. Saving the
# settings or reconnecting clears them at once (invalidate_brand).
LASTING_CODES = frozenset({API_DISABLED, PERMISSION_DENIED, INVALID_PROPERTY, NOT_CONFIGURED})


def negative_ttl(code: str) -> float:
    return LASTING_ERROR_TTL if code in LASTING_CODES else NEGATIVE_TTL


class GAError(Exception):
    """A normalised, user-safe Google Analytics error.

    `message` is always written by us (never Google's raw text) and never
    contains a token. `http_status` is the upstream status when there was one.
    """

    def __init__(self, code: str, message: Optional[str] = None, http_status: Optional[int] = None):
        if code not in ERROR_CODES:
            code = UPSTREAM_ERROR
        self.code = code
        self.message = message or DEFAULT_MESSAGES[code]
        self.http_status = http_status
        super().__init__(f"{code}: {self.message}")

    def to_dict(self) -> Dict[str, str]:
        return {"code": self.code, "message": self.message}


# ---------------------------------------------------------------------------
# OAuth client (the same Google Cloud web client as Gmail)
# ---------------------------------------------------------------------------

def _client_credentials() -> Tuple[str, str]:
    # Read at call time (not import time): the Setup Wizard may write the
    # env after the process started.
    return (os.getenv("GOOGLE_CLIENT_ID", "").strip(), os.getenv("GOOGLE_CLIENT_SECRET", "").strip())


def is_configured() -> bool:
    cid, secret = _client_credentials()
    return bool(cid and secret)


def build_oauth_flow(redirect_uri: str):
    """google_auth_oauthlib Flow for the GA scopes (like the Gmail flow).

    No PKCE (the callback is served by a fresh process/Flow and this is a
    confidential web client; exchange_code() sends no code_verifier), so it
    is switched off explicitly rather than relying on a library default. The
    caller must NOT pass include_granted_scopes: the stored token is then
    limited to the GA scopes, never the brand's Gmail scopes.
    """
    from google_auth_oauthlib.flow import Flow

    cid, secret = _client_credentials()
    if not (cid and secret):
        raise GAError(NOT_CONFIGURED)
    client_config = {
        "web": {
            "client_id": cid,
            "client_secret": secret,
            "auth_uri": AUTH_URI,
            "token_uri": TOKEN_URI,
            "redirect_uris": [redirect_uri],
        }
    }
    return Flow.from_client_config(client_config, scopes=SCOPES, redirect_uri=redirect_uri,
                                   autogenerate_code_verifier=False)


def authorization_url(flow, state: str) -> str:
    """Consent URL: offline access (refresh token), Google's account chooser
    (so "Switch account" can really pick another account) and a forced
    consent screen so Google always returns a refresh token."""
    url, _ = flow.authorization_url(access_type="offline", prompt="select_account consent", state=state)
    return url


def allow_google_scope_union() -> None:
    """Let oauthlib accept a token response whose scopes differ from the
    requested ones. Called once at startup (api/main.py).

    The Gmail connect flows ask Google for include_granted_scopes=true, so
    Google answers with the UNION of every scope the account ever granted to
    this (shared) OAuth client. Once an account has connected Google Analytics
    that union includes analytics.readonly, and oauthlib's Flow.fetch_token
    would raise "Scope has changed" and break the Gmail connect for that
    account. Trade-off: a Gmail connect where the user unticked a Gmail scope
    is no longer refused at connect time (it fails later, when that permission is used).
    Respects an explicit value set by the operator.
    """
    os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")


def _granted_scopes(token_response: Dict[str, Any]) -> List[str]:
    raw = token_response.get("scope") or ""
    if isinstance(raw, (list, tuple)):
        return [str(s) for s in raw]
    return [s for s in str(raw).split() if s]


def _email_from_id_token(id_token: Optional[str], client_id: str) -> Optional[str]:
    """Email claim of the ID token we just received DIRECTLY from Google's
    token endpoint over TLS (OIDC core 3.1.3.7 allows TLS server validation in
    place of the signature check here). Display only - never used for authz."""
    if not id_token:
        return None
    try:
        claims = pyjwt.decode(id_token, options={"verify_signature": False})
    except pyjwt.PyJWTError:
        return None
    if claims.get("iss") not in ("https://accounts.google.com", "accounts.google.com"):
        return None
    aud = claims.get("aud")
    if aud != client_id and not (isinstance(aud, list) and client_id in aud):
        return None
    email = claims.get("email")
    return str(email).strip() if email else None


def exchange_code(redirect_uri: str, code: str, http: Any = requests) -> Dict[str, Any]:
    """Exchange an authorization code for tokens.

    Done with a plain POST (not Flow.fetch_token): we read the granted scopes
    ourselves, so a user who unticks the analytics permission on Google's
    consent screen gets a clear error (the router checks ANALYTICS_SCOPE),
    and extra scopes Google may add are simply ignored. It does not depend on
    oauthlib's process-wide scope check (see allow_google_scope_union).

    Returns {"refresh_token", "scopes", "email"}. Raises GAError with codes
    the callback turns into ?ga_error=...
    """
    cid, secret = _client_credentials()
    if not (cid and secret):
        raise GAError(NOT_CONFIGURED)
    try:
        resp = http.post(
            TOKEN_URI,
            data={
                "code": code,
                "client_id": cid,
                "client_secret": secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=HTTP_TIMEOUT,
        )
    except requests.RequestException:
        raise GAError(UPSTREAM_ERROR, "Could not reach Google to finish signing in.") from None
    payload = _safe_json(resp)
    if getattr(resp, "status_code", 500) >= 400 or not isinstance(payload, dict) or "error" in payload:
        err = str((payload or {}).get("error") or "") if isinstance(payload, dict) else ""
        log.warning("GA OAuth code exchange failed: HTTP %s %s", getattr(resp, "status_code", "?"), err[:40])
        raise GAError(UPSTREAM_ERROR, "Google refused the sign-in code. Start the connection again.") from None
    access_token = payload.get("access_token")
    scopes = _granted_scopes(payload)
    email = _email_from_id_token(payload.get("id_token"), cid)
    if not email and access_token:
        try:
            info = http.get(USERINFO_URI, headers={"Authorization": f"Bearer {access_token}"},
                            timeout=HTTP_TIMEOUT)
            data = _safe_json(info)
            if getattr(info, "status_code", 500) < 400 and isinstance(data, dict) and data.get("email"):
                email = str(data["email"]).strip()
        except requests.RequestException:
            pass
    return {
        "refresh_token": payload.get("refresh_token") or None,
        "scopes": scopes,
        "email": email,
    }


def credentials_from_refresh_token(refresh_token: str):
    """Credentials that mint short-lived access tokens from the brand's
    refresh token, down-scoped to analytics.readonly."""
    from google.oauth2.credentials import Credentials

    cid, secret = _client_credentials()
    if not (cid and secret):
        raise GAError(NOT_CONFIGURED)
    if not refresh_token:
        raise GAError(NOT_CONNECTED)
    return Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri=TOKEN_URI,
        client_id=cid,
        client_secret=secret,
        scopes=[ANALYTICS_SCOPE],
    )


class CredentialsCache:
    """In-process Credentials per (brand_id, sha256(refresh token)).

    Reusing the Credentials object reuses its short-lived access token until
    it expires, instead of asking Google's token endpoint before every
    dashboard refresh. The key starts with the brand id (docs/MULTIBRAND.md
    rule 5) and holds only a hash of the refresh token (and of the OAuth
    client, so a rotated client secret is picked up), never the token.
    Each entry has its own lock so one refresh serves concurrent callers.
    """

    def __init__(self, max_entries: int = 500):
        self._items: Dict[Tuple[str, str], Tuple[Any, threading.Lock]] = {}
        self._lock = threading.Lock()
        self._max = max_entries

    @staticmethod
    def _key(brand_id: Any, refresh_token: str) -> Tuple[str, str]:
        cid, secret = _client_credentials()
        material = "\0".join((cid, secret, refresh_token)).encode("utf-8")
        return (str(brand_id), hashlib.sha256(material).hexdigest())

    def get(self, brand_id: Any, refresh_token: str) -> Tuple[Any, threading.Lock]:
        key = self._key(brand_id, refresh_token)
        with self._lock:
            item = self._items.get(key)
            if item is None:
                item = (credentials_from_refresh_token(refresh_token), threading.Lock())
                self._items[key] = item
                while len(self._items) > self._max:
                    self._items.pop(next(iter(self._items)))  # oldest insert first
            return item

    def invalidate_brand(self, brand_id: Any) -> None:
        b = str(brand_id)
        with self._lock:
            for k in [k for k in self._items if k[0] == b]:
                self._items.pop(k, None)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()


CREDENTIALS = CredentialsCache()


def authorized_session(refresh_token: str, brand_id: Any):
    """requests-compatible session for the brand's Google account.

    The access token is refreshed here, once, only when the cached one is
    missing or about to expire (10 s timeout), so the session never needs to
    refresh on its own and can be shared by the parallel report calls. Use it
    as a context manager so its connection pools are closed:

        with authorized_session(token, brand_id) as s:
            fetch_realtime(s, property_id)

    Raises GAError (e.g. reconnect_required for a revoked grant).
    """
    from google.auth.transport.requests import AuthorizedSession, Request as GoogleAuthRequest

    if not refresh_token:
        raise GAError(NOT_CONNECTED)
    creds, lock = CREDENTIALS.get(brand_id, refresh_token)
    with lock:
        if not creds.valid:
            http = requests.Session()
            try:
                creds.refresh(functools.partial(GoogleAuthRequest(http), timeout=HTTP_TIMEOUT))
            except Exception as exc:  # RefreshError, TransportError...
                err = error_from_exception(exc)
                log.warning("GA access token refresh failed: %s (%s)", err.code, type(exc).__name__)
                raise err from None
            finally:
                http.close()
    return AuthorizedSession(creds, refresh_timeout=HTTP_TIMEOUT)


def revoke_token(token: str, http: Any = requests) -> bool:
    """Best-effort revoke at Google. Never raises, never logs the token.

    NOTE: Google revokes the whole grant of this OAuth client for that
    Google account. The router only calls this when the account is not also
    used for Gmail sending (same OAuth client) anywhere on the deployment.
    """
    if not token:
        return False
    try:
        resp = http.post(REVOKE_URI, data={"token": token},
                         headers={"Content-Type": "application/x-www-form-urlencoded"},
                         timeout=HTTP_TIMEOUT)
        return getattr(resp, "status_code", 500) == 200
    except Exception:
        return False


# ---------------------------------------------------------------------------
# HTTP layer + error mapping
# ---------------------------------------------------------------------------

def _safe_json(resp: Any) -> Any:
    try:
        return resp.json()
    except Exception:
        return None


def _error_reasons(err: Dict[str, Any]) -> Tuple[set, set]:
    """(reasons, services) found in a Google error body (new + legacy shapes)."""
    reasons, services = set(), set()
    for d in err.get("details") or []:
        if not isinstance(d, dict):
            continue
        if d.get("reason"):
            reasons.add(str(d["reason"]).upper())
        meta = d.get("metadata") if isinstance(d.get("metadata"), dict) else {}
        for k in ("service", "consumer_service"):
            if meta.get(k):
                services.add(str(meta[k]).lower())
    for e in err.get("errors") or []:   # legacy {"errors": [{"reason": "accessNotConfigured"}]}
        if isinstance(e, dict) and e.get("reason"):
            reasons.add(str(e["reason"]).upper())
    return reasons, services


def _api_disabled_message(services: set, text: str) -> str:
    names = []
    if any("analyticsdata" in s for s in services) or "analyticsdata" in text or "data api" in text:
        names.append('"Google Analytics Data API"')
    if any("analyticsadmin" in s for s in services) or "analyticsadmin" in text or "admin api" in text:
        names.append('"Google Analytics Admin API"')
    which = " and ".join(names) if names else "a required Google Analytics API"
    return f"{which} is not enabled for this deployment. " + _ENABLE_APIS_HINT


def error_from_response(status: int, payload: Any) -> GAError:
    """Map a Google API error response to a GAError (never echoes Google's text)."""
    err = payload.get("error") if isinstance(payload, dict) else None
    if not isinstance(err, dict):
        err = {}
    gstatus = str(err.get("status") or "").upper()
    text = str(err.get("message") or "").lower()
    reasons, services = _error_reasons(err)

    if ("SERVICE_DISABLED" in reasons or "ACCESSNOTCONFIGURED" in reasons
            or "has not been used in project" in text
            or ("api" in text and "is disabled" in text)):
        return GAError(API_DISABLED, _api_disabled_message(services, text), status)
    if (status == 429 or gstatus == "RESOURCE_EXHAUSTED"
            or any(("RATE_LIMIT" in r or "QUOTA" in r) for r in reasons)):
        return GAError(QUOTA_EXCEEDED, http_status=status)
    if "ACCESS_TOKEN_SCOPE_INSUFFICIENT" in reasons or "insufficient authentication scopes" in text:
        return GAError(RECONNECT_REQUIRED,
                       "Google Analytics access was not granted when this brand connected. Reconnect and "
                       "allow \"See and download your Google Analytics data\".", status)
    if status == 401 or gstatus == "UNAUTHENTICATED":
        return GAError(RECONNECT_REQUIRED, http_status=status)
    if status == 403 or gstatus == "PERMISSION_DENIED":
        return GAError(PERMISSION_DENIED, http_status=status)
    if status == 404 or gstatus == "NOT_FOUND":
        return GAError(INVALID_PROPERTY, http_status=status)
    if status == 400 or gstatus in ("INVALID_ARGUMENT", "FAILED_PRECONDITION"):
        if "propert" in text:
            return GAError(INVALID_PROPERTY, http_status=status)
        return GAError(UPSTREAM_ERROR, f"Google Analytics rejected the report request (HTTP {status}).", status)
    return GAError(UPSTREAM_ERROR, f"Google Analytics returned an unexpected error (HTTP {status}). "
                                   "Try again in a minute.", status)


def error_from_exception(exc: BaseException) -> GAError:
    """Map transport / token-refresh exceptions (never echoes their text)."""
    try:
        from google.auth import exceptions as gexc
    except Exception:  # pragma: no cover - google-auth is a hard dependency
        gexc = None
    if isinstance(exc, GAError):
        return exc
    if gexc is not None and isinstance(exc, gexc.RefreshError):
        text = str(exc).lower()
        if "invalid_grant" in text or "unauthorized_client" in text or "invalid_scope" in text \
                or "not all requested scopes" in text:
            return GAError(RECONNECT_REQUIRED)
        if "invalid_client" in text:
            return GAError(NOT_CONFIGURED, "Google rejected this server's OAuth client "
                                           "(check GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).")
        return GAError(UPSTREAM_ERROR, "Could not refresh Google access. Try again in a minute.")
    if isinstance(exc, requests.Timeout):
        return GAError(UPSTREAM_ERROR, "Google Analytics did not answer in time. Try again in a minute.")
    if isinstance(exc, requests.RequestException) or (gexc is not None and isinstance(exc, gexc.TransportError)):
        return GAError(UPSTREAM_ERROR, "Could not reach Google Analytics. Try again in a minute.")
    return GAError(UPSTREAM_ERROR)


def _call(session: Any, method: str, url: str, body: Optional[dict] = None) -> Dict[str, Any]:
    """One Google API call -> parsed JSON object, or GAError."""
    try:
        if body is None:
            resp = session.request(method, url, timeout=HTTP_TIMEOUT)
        else:
            resp = session.request(method, url, json=body, timeout=HTTP_TIMEOUT)
    except GAError:
        raise
    except Exception as exc:  # RefreshError, TransportError, requests errors...
        err = error_from_exception(exc)
        log.warning("GA call %s failed: %s (%s)", url.split("?")[0], err.code, type(exc).__name__)
        raise err from None
    status = int(getattr(resp, "status_code", 500) or 500)
    payload = _safe_json(resp)
    if status >= 400:
        err = error_from_response(status, payload)
        log.warning("GA call %s failed: HTTP %s -> %s", url.split("?")[0], status, err.code)
        raise err
    if not isinstance(payload, dict):
        raise GAError(UPSTREAM_ERROR, "Google Analytics sent a response that could not be read.", status)
    return payload


# ---------------------------------------------------------------------------
# Response parsing helpers (GA omits `rows` when empty; values are strings)
# ---------------------------------------------------------------------------

def to_number(value: Any) -> float:
    try:
        n = float(str(value).strip())
    except (TypeError, ValueError):
        return 0.0
    if n != n or n in (float("inf"), float("-inf")):  # NaN / inf
        return 0.0
    return n


def to_int(value: Any) -> int:
    return int(round(to_number(value)))


def report_rows(report: Any) -> List[dict]:
    rows = report.get("rows") if isinstance(report, dict) else None
    return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []


def row_dim(row: dict, i: int = 0) -> str:
    vals = row.get("dimensionValues") or []
    if i < len(vals) and isinstance(vals[i], dict):
        v = vals[i].get("value")
        return "" if v is None else str(v)
    return ""


def row_metric(row: dict, i: int = 0) -> float:
    vals = row.get("metricValues") or []
    if i < len(vals) and isinstance(vals[i], dict):
        return to_number(vals[i].get("value"))
    return 0.0


def report_total(report: Any, i: int = 0) -> float:
    """Metric i of a report without dimensions (one row, or none when 0)."""
    rows = report_rows(report)
    return row_metric(rows[0], i) if rows else 0.0


def _label(value: str) -> str:
    v = (value or "").strip()
    return v if v else "(not set)"


def require_property_id(property_id: Any) -> str:
    pid = str(property_id or "").strip()
    if not PROPERTY_ID_RE.match(pid):
        raise GAError(INVALID_PROPERTY)
    return pid


def run_parallel(calls: Dict[str, Callable[[], Any]], max_workers: int = _MAX_PARALLEL) -> Dict[str, Any]:
    """Run independent Google calls at the same time; {name: result}.

    Waits for all of them (each is bounded by HTTP_TIMEOUT), then raises the
    first error in `calls` order, so the outcome does not depend on timing.
    The callers share one AuthorizedSession: requests' connection pool is
    thread-safe and authorized_session() already refreshed the access token,
    so no worker refreshes it on its own.
    """
    if len(calls) <= 1:
        return {name: fn() for name, fn in calls.items()}
    with ThreadPoolExecutor(max_workers=min(len(calls), max_workers), thread_name_prefix="ga") as pool:
        futures = {name: pool.submit(fn) for name, fn in calls.items()}
    results: Dict[str, Any] = {}
    first_error: Optional[GAError] = None
    for name, fut in futures.items():
        try:
            results[name] = fut.result()
        except Exception as exc:
            if first_error is None:
                first_error = error_from_exception(exc)
    if first_error is not None:
        raise first_error
    return results


# ---------------------------------------------------------------------------
# Admin API: properties the connected account can read
# ---------------------------------------------------------------------------

_PROPERTY_RE = re.compile(r"^properties/([0-9]{1,20})$")


def parse_account_summaries(data: Any) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    if not isinstance(data, dict):
        return out
    for acc in data.get("accountSummaries") or []:
        if not isinstance(acc, dict):
            continue
        account_name = str(acc.get("displayName") or "").strip()
        for p in acc.get("propertySummaries") or []:
            if not isinstance(p, dict):
                continue
            m = _PROPERTY_RE.match(str(p.get("property") or "").strip())
            if not m:
                continue
            pid = m.group(1)
            out.append({
                "property_id": pid,
                "display_name": str(p.get("displayName") or "").strip() or f"Property {pid}",
                "account_name": account_name,
            })
    return out


def list_properties(session: Any) -> List[Dict[str, str]]:
    props: List[Dict[str, str]] = []
    seen = set()
    page_token: Optional[str] = None
    for _ in range(_MAX_ADMIN_PAGES):
        url = f"{ADMIN_API}/accountSummaries?pageSize=200"
        if page_token:
            url += "&pageToken=" + quote(page_token, safe="")
        data = _call(session, "GET", url)
        for p in parse_account_summaries(data):
            if p["property_id"] not in seen:
                seen.add(p["property_id"])
                props.append(p)
        page_token = data.get("nextPageToken") or None
        if not page_token:
            break
    props.sort(key=lambda p: (p["account_name"].lower(), p["display_name"].lower(), p["property_id"]))
    return props


# ---------------------------------------------------------------------------
# Data API: realtime (last 30 minutes)
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def realtime_requests() -> Dict[str, dict]:
    """Realtime reports. Realtime has NO source / campaign dimensions."""
    users = [{"name": "activeUsers"}]
    by_users = [{"metric": {"metricName": "activeUsers"}, "desc": True}]
    return {
        "total": {"metrics": users},
        "per_minute": {"dimensions": [{"name": "minutesAgo"}], "metrics": users, "limit": 60},
        "top_pages": {"dimensions": [{"name": "unifiedScreenName"}], "metrics": users,
                      "orderBys": by_users, "limit": 8},
        "countries": {"dimensions": [{"name": "country"}], "metrics": users, "orderBys": by_users, "limit": 8},
        "devices": {"dimensions": [{"name": "deviceCategory"}], "metrics": users, "orderBys": by_users,
                    "limit": 5},
    }


def zero_filled_minutes(report: Any = None) -> List[Dict[str, int]]:
    users = {m: 0 for m in range(REALTIME_MINUTES)}
    for row in report_rows(report):
        try:
            minute = int(row_dim(row, 0))
        except ValueError:
            continue
        if 0 <= minute < REALTIME_MINUTES:
            users[minute] += to_int(row_metric(row, 0))
    return [{"minutes_ago": m, "users": users[m]} for m in range(REALTIME_MINUTES)]


def _top(report: Any, limit: int) -> List[Dict[str, Any]]:
    agg: Dict[str, int] = {}
    for row in report_rows(report):
        name = _label(row_dim(row, 0))
        agg[name] = agg.get(name, 0) + to_int(row_metric(row, 0))
    items = sorted(agg.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]
    return [{"name": k, "users": v} for k, v in items]


def empty_realtime() -> Dict[str, Any]:
    return {
        "active_users": 0,
        "per_minute": zero_filled_minutes(None),
        "top_pages": [],
        "countries": [],
        "devices": [],
        "fetched_at": _now_iso(),
    }


def parse_realtime(reports: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "active_users": to_int(report_total(reports.get("total"))),
        "per_minute": zero_filled_minutes(reports.get("per_minute")),
        "top_pages": _top(reports.get("top_pages"), 8),
        "countries": _top(reports.get("countries"), 8),
        "devices": _top(reports.get("devices"), 5),
        "fetched_at": _now_iso(),
    }


def fetch_realtime(session: Any, property_id: str) -> Dict[str, Any]:
    """The 5 realtime reports, requested in parallel (realtime has no batch
    endpoint), so a fetch takes one round trip (at most ~HTTP_TIMEOUT)."""
    pid = require_property_id(property_id)
    url = f"{DATA_API}/properties/{pid}:runRealtimeReport"
    reports = run_parallel({name: functools.partial(_call, session, "POST", url, body)
                            for name, body in realtime_requests().items()})
    return parse_realtime(reports)


# ---------------------------------------------------------------------------
# Data API: period summary + the outreach (email) panel
# ---------------------------------------------------------------------------

def date_range(days: int) -> Dict[str, str]:
    """The last `days` calendar days including today (property timezone).
    days=1 -> today only."""
    if days not in ALLOWED_DAYS:
        raise ValueError(f"days must be one of {ALLOWED_DAYS}")
    start = "today" if days == 1 else f"{days - 1}daysAgo"
    return {"startDate": start, "endDate": "today"}


def source_filter(highlight_source: str) -> Dict[str, Any]:
    return {"filter": {"fieldName": "sessionSource",
                       "stringFilter": {"matchType": "EXACT", "value": highlight_source,
                                        "caseSensitive": False}}}


_SUMMARY_KEYS = ("totals", "sources", "email_totals", "by_campaign", "by_sender", "daily", "landing_pages")


def summary_requests(days: int, highlight_source: Optional[str]) -> List[Tuple[str, dict]]:
    """(name, RunReportRequest) pairs. The email ones only when a utm_source
    to highlight is set (empty -> the email panel stays empty)."""
    rng = [date_range(days)]

    def m(*names: str) -> List[Dict[str, str]]:
        return [{"name": n} for n in names]

    by_sessions = [{"metric": {"metricName": "sessions"}, "desc": True}]
    out: List[Tuple[str, dict]] = [
        ("totals", {"dateRanges": rng, "metrics": m("sessions", "activeUsers", "keyEvents", "engagementRate")}),
        ("sources", {"dateRanges": rng, "dimensions": [{"name": "sessionSource"}, {"name": "sessionMedium"}],
                     "metrics": m("sessions", "activeUsers"), "orderBys": by_sessions, "limit": 10}),
    ]
    src = (highlight_source or "").strip()
    if src:
        flt = source_filter(src)
        out += [
            ("email_totals", {"dateRanges": rng, "metrics": m("sessions", "activeUsers", "keyEvents"),
                              "dimensionFilter": flt}),
            ("by_campaign", {"dateRanges": rng, "dimensions": [{"name": "sessionCampaignName"}],
                             "metrics": m("sessions", "activeUsers", "keyEvents"), "dimensionFilter": flt,
                             "orderBys": by_sessions, "limit": 20}),
            ("by_sender", {"dateRanges": rng, "dimensions": [{"name": "sessionManualTerm"}],
                           "metrics": m("sessions", "activeUsers", "keyEvents"), "dimensionFilter": flt,
                           "orderBys": by_sessions, "limit": 20}),
            ("daily", {"dateRanges": rng, "dimensions": [{"name": "date"}], "metrics": m("sessions"),
                       "dimensionFilter": flt,
                       "orderBys": [{"dimension": {"dimensionName": "date"}, "desc": False}], "limit": 400}),
            ("landing_pages", {"dateRanges": rng, "dimensions": [{"name": "landingPage"}],
                               "metrics": m("sessions"), "dimensionFilter": flt, "orderBys": by_sessions,
                               "limit": 10}),
        ]
    return out


def chunks(items: Sequence[Any], size: int = _MAX_BATCH) -> List[List[Any]]:
    return [list(items[i:i + size]) for i in range(0, len(items), size)]


def property_today(tz_name: Any, now: Optional[datetime] = None) -> Optional[date]:
    """Today's date in the GA property's time zone (GA's "today" and
    "NdaysAgo" are in that zone). None when the zone is unknown."""
    if not tz_name or not isinstance(tz_name, str):
        return None
    try:
        from zoneinfo import ZoneInfo

        zone = ZoneInfo(tz_name)
    except Exception:  # unknown zone, no tz database, malformed name
        return None
    return (now or datetime.now(timezone.utc)).astimezone(zone).date()


def report_time_zone(reports: Dict[str, Any]) -> Optional[str]:
    """The property's time zone from the reports' metadata, if GA sent it."""
    for report in reports.values():
        meta = report.get("metadata") if isinstance(report, dict) else None
        tz = meta.get("timeZone") if isinstance(meta, dict) else None
        if isinstance(tz, str) and tz.strip():
            return tz.strip()
    return None


def daily_series(report: Any, days: int, today: Optional[date] = None) -> List[Dict[str, Any]]:
    """`days` points ending `today` (the property's date - see
    property_today), zero-filled. Without it, UTC's date is used; then a GA
    date past that (property ahead of UTC) moves the end forward, and one
    before the window (property behind UTC) is kept rather than dropped."""
    vals: Dict[str, int] = {}
    for row in report_rows(report):
        d = row_dim(row, 0)
        if not re.fullmatch(r"[0-9]{8}", d):
            continue
        iso = f"{d[:4]}-{d[4:6]}-{d[6:]}"
        try:
            date.fromisoformat(iso)
        except ValueError:
            continue
        vals[iso] = vals.get(iso, 0) + to_int(row_metric(row, 0))
    end = today or datetime.now(timezone.utc).date()
    if vals:
        latest = max(date.fromisoformat(k) for k in vals)
        if latest > end:
            end = latest
    start = end - timedelta(days=max(days, 1) - 1)
    out = [{"date": k, "sessions": vals[k]} for k in sorted(vals) if k < start.isoformat()]
    cur = start
    while cur <= end:
        out.append({"date": cur.isoformat(), "sessions": vals.get(cur.isoformat(), 0)})
        cur += timedelta(days=1)
    return out


def empty_email_panel() -> Dict[str, Any]:
    return {
        "totals": {"sessions": 0, "users": 0, "key_events": 0},
        "by_campaign": [],
        "by_sender": [],
        "daily": [],
        "landing_pages": [],
    }


def empty_summary(days: int, highlight_source: Optional[str]) -> Dict[str, Any]:
    return {
        "days": days,
        "highlight_source": highlight_source or None,
        "totals": {"sessions": 0, "users": 0, "key_events": 0, "engagement_rate": 0.0},
        "sources": [],
        "email": empty_email_panel(),
        "fetched_at": _now_iso(),
    }


def _breakdown(report: Any, key: str) -> List[Dict[str, Any]]:
    out = []
    for row in report_rows(report):
        out.append({key: _label(row_dim(row, 0)), "sessions": to_int(row_metric(row, 0)),
                    "users": to_int(row_metric(row, 1)), "key_events": to_int(row_metric(row, 2))})
    out.sort(key=lambda r: (-r["sessions"], r[key]))
    return out


def parse_summary(days: int, highlight_source: Optional[str], reports: Dict[str, Any],
                  today: Optional[date] = None) -> Dict[str, Any]:
    result = empty_summary(days, highlight_source)
    t = reports.get("totals")
    result["totals"] = {
        "sessions": to_int(report_total(t, 0)),
        "users": to_int(report_total(t, 1)),
        "key_events": to_int(report_total(t, 2)),
        "engagement_rate": round(report_total(t, 3), 4),
    }
    sources = []
    for row in report_rows(reports.get("sources")):
        sources.append({"source": _label(row_dim(row, 0)), "medium": _label(row_dim(row, 1)),
                        "sessions": to_int(row_metric(row, 0)), "users": to_int(row_metric(row, 1))})
    sources.sort(key=lambda r: -r["sessions"])
    result["sources"] = sources

    if (highlight_source or "").strip():
        et = reports.get("email_totals")
        pages = [{"page": _label(row_dim(r, 0)), "sessions": to_int(row_metric(r, 0))}
                 for r in report_rows(reports.get("landing_pages"))]
        pages.sort(key=lambda r: -r["sessions"])
        result["email"] = {
            "totals": {"sessions": to_int(report_total(et, 0)), "users": to_int(report_total(et, 1)),
                       "key_events": to_int(report_total(et, 2))},
            "by_campaign": _breakdown(reports.get("by_campaign"), "campaign"),
            "by_sender": _breakdown(reports.get("by_sender"), "sender"),
            "daily": daily_series(reports.get("daily"), days, today),
            "landing_pages": pages,
        }
    return result


def fetch_summary(session: Any, property_id: str, days: int, highlight_source: Optional[str]) -> Dict[str, Any]:
    """Up to 7 reports in batches of 5, the batches requested in parallel.
    The daily series is aligned to the property's own date (GA's metadata
    time zone), the same calendar GA's dateRanges use."""
    pid = require_property_id(property_id)
    groups = chunks(summary_requests(days, highlight_source))
    url = f"{DATA_API}/properties/{pid}:batchRunReports"
    answers = run_parallel({
        f"batch{i}": functools.partial(_call, session, "POST", url, {"requests": [body for _, body in group]})
        for i, group in enumerate(groups)
    })
    reports: Dict[str, Any] = {}
    for i, group in enumerate(groups):
        data = answers.get(f"batch{i}") or {}
        got = data.get("reports") if isinstance(data.get("reports"), list) else []
        for j, (name, _) in enumerate(group):
            reports[name] = got[j] if j < len(got) and isinstance(got[j], dict) else {}
    today = property_today(report_time_zone(reports))
    return parse_summary(days, highlight_source, reports, today=today)


# ---------------------------------------------------------------------------
# Data API: the full website report (the Website analytics page)
# ---------------------------------------------------------------------------

REPORT_DAYS = (7, 28, 90)
REPORT_TTL = 300               # seconds, like the summary

_REPORT_TOTAL_METRICS = ("activeUsers", "newUsers", "sessions", "screenPageViews", "engagementRate",
                         "userEngagementDuration", "eventCount", "keyEvents")


def report_date_ranges(days: int) -> List[Dict[str, str]]:
    """[current, previous]: the last `days` complete days (ending yesterday,
    like GA's own "Last N days") and the `days` days before them (property
    time zone), named so a two-range report's rows can be told apart.
    Today is left out so both periods are whole days and the % change is
    fair; the LIVE strip covers today."""
    if days not in REPORT_DAYS:
        raise ValueError(f"days must be one of {REPORT_DAYS}")
    return [
        {"startDate": f"{days}daysAgo", "endDate": "yesterday", "name": "current"},
        {"startDate": f"{2 * days}daysAgo", "endDate": f"{days + 1}daysAgo", "name": "previous"},
    ]


def report_period(days: int, today: Optional[date] = None) -> Dict[str, Dict[str, str]]:
    """The calendar dates the report covers: {"range": {start, end},
    "previous_range": {start, end}} (ISO dates), both ending before
    `today` (see report_date_ranges). `today` is the property's date
    (property_today); UTC's date when unknown."""
    end = (today or datetime.now(timezone.utc).date()) - timedelta(days=1)
    start = end - timedelta(days=days - 1)
    prev_end = start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=days - 1)
    return {"range": {"start": start.isoformat(), "end": end.isoformat()},
            "previous_range": {"start": prev_start.isoformat(), "end": prev_end.isoformat()}}


def report_requests(days: int, highlight_source: Optional[str]) -> List[Tuple[str, dict]]:
    """(name, RunReportRequest) pairs for the website report: 13 site-wide
    reports, plus 3 for the outreach source when one is set (-> 4 batches)."""
    cur = [report_date_ranges(days)[0]]

    def m(*names: str) -> List[Dict[str, str]]:
        return [{"name": n} for n in names]

    def d(*names: str) -> List[Dict[str, str]]:
        return [{"name": n} for n in names]

    def desc(metric: str) -> List[Dict[str, Any]]:
        return [{"metric": {"metricName": metric}, "desc": True}]

    out: List[Tuple[str, dict]] = [
        ("totals", {"dateRanges": report_date_ranges(days), "metrics": m(*_REPORT_TOTAL_METRICS)}),
        ("daily", {"dateRanges": cur, "dimensions": d("date"),
                   "metrics": m("activeUsers", "sessions", "screenPageViews"),
                   "orderBys": [{"dimension": {"dimensionName": "date"}, "desc": False}], "limit": 400}),
        ("countries", {"dateRanges": cur, "dimensions": d("country"), "metrics": m("activeUsers", "sessions"),
                       "orderBys": desc("activeUsers"), "limit": 15}),
        ("cities", {"dateRanges": cur, "dimensions": d("city", "country"), "metrics": m("activeUsers"),
                    "orderBys": desc("activeUsers"), "limit": 10}),
        ("channels", {"dateRanges": cur, "dimensions": d("sessionDefaultChannelGroup"),
                      "metrics": m("sessions", "activeUsers"), "orderBys": desc("sessions"), "limit": 20}),
        ("sources", {"dateRanges": cur, "dimensions": d("sessionSource", "sessionMedium"),
                     "metrics": m("sessions", "activeUsers"), "orderBys": desc("sessions"), "limit": 10}),
        # a path can have several titles: ask for more rows, merged per path in parse_report
        ("pages", {"dateRanges": cur, "dimensions": d("pagePath", "pageTitle"),
                   "metrics": m("screenPageViews", "activeUsers", "userEngagementDuration"),
                   "orderBys": desc("screenPageViews"), "limit": 25}),
        ("landing_pages", {"dateRanges": cur, "dimensions": d("landingPage"), "metrics": m("sessions"),
                           "orderBys": desc("sessions"), "limit": 10}),
        ("devices", {"dateRanges": cur, "dimensions": d("deviceCategory"), "metrics": m("activeUsers"),
                     "orderBys": desc("activeUsers"), "limit": 10}),
        ("browsers", {"dateRanges": cur, "dimensions": d("browser"), "metrics": m("activeUsers"),
                      "orderBys": desc("activeUsers"), "limit": 6}),
        ("os", {"dateRanges": cur, "dimensions": d("operatingSystem"), "metrics": m("activeUsers"),
                "orderBys": desc("activeUsers"), "limit": 6}),
        ("new_vs_returning", {"dateRanges": cur, "dimensions": d("newVsReturning"), "metrics": m("activeUsers"),
                              "limit": 10}),
        ("events", {"dateRanges": cur, "dimensions": d("eventName"), "metrics": m("eventCount"),
                    "orderBys": desc("eventCount"), "limit": 15}),
    ]
    src = (highlight_source or "").strip()
    if src:
        flt = source_filter(src)
        out += [
            ("email_totals", {"dateRanges": cur, "metrics": m("sessions", "activeUsers", "keyEvents"),
                              "dimensionFilter": flt}),
            ("email_by_campaign", {"dateRanges": cur, "dimensions": d("sessionCampaignName"),
                                   "metrics": m("sessions"), "dimensionFilter": flt,
                                   "orderBys": desc("sessions"), "limit": 20}),
            ("email_by_sender", {"dateRanges": cur, "dimensions": d("sessionManualTerm"),
                                 "metrics": m("sessions"), "dimensionFilter": flt,
                                 "orderBys": desc("sessions"), "limit": 20}),
        ]
    return out


def empty_report_totals() -> Dict[str, Any]:
    return {"users": 0, "new_users": 0, "sessions": 0, "page_views": 0, "engagement_rate": 0.0,
            "avg_engagement_seconds": 0.0, "events": 0, "key_events": 0}


def empty_email_ga() -> Dict[str, Any]:
    return {"sessions": 0, "users": 0, "key_events": 0, "by_campaign": [], "by_sender": []}


def _days_between(start: str, end: str) -> List[str]:
    cur, last = date.fromisoformat(start), date.fromisoformat(end)
    out = []
    while cur <= last:
        out.append(cur.isoformat())
        cur += timedelta(days=1)
    return out


def empty_report(days: int, highlight_source: Optional[str], today: Optional[date] = None) -> Dict[str, Any]:
    """Every GA section of the report, empty (zero-filled daily series)."""
    period = report_period(days, today)
    rng = period["range"]
    return {
        "days": days,
        "range": dict(rng),
        "previous_range": dict(period["previous_range"]),
        "time_zone": None,
        "highlight_source": (highlight_source or "").strip() or None,
        "totals": empty_report_totals(),
        "previous": empty_report_totals(),
        "daily": [{"date": dt, "users": 0, "sessions": 0, "page_views": 0}
                  for dt in _days_between(rng["start"], rng["end"])],
        "countries": [], "cities": [], "channels": [], "sources": [], "pages": [], "landing_pages": [],
        "devices": [], "browsers": [], "os": [],
        "new_vs_returning": [{"type": "new", "users": 0}, {"type": "returning", "users": 0}],
        "events": [],
        "email_ga": empty_email_ga(),
        "fetched_at": _now_iso(),
    }


def _totals_from_values(vals: Sequence[float]) -> Dict[str, Any]:
    def v(i: int) -> float:
        return vals[i] if i < len(vals) else 0.0

    users = to_int(v(0))
    return {
        "users": users,
        "new_users": to_int(v(1)),
        "sessions": to_int(v(2)),
        "page_views": to_int(v(3)),
        "engagement_rate": round(v(4), 4),
        "avg_engagement_seconds": round(v(5) / users, 1) if users else 0.0,
        "events": to_int(v(6)),
        "key_events": to_int(v(7)),
    }


def parse_report_totals(report: Any) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """(current, previous) from the two-date-range totals report. GA adds a
    dateRange dimension (our range names, or date_range_0/1) and leaves out
    a range that has no data."""
    n = len(_REPORT_TOTAL_METRICS)
    found: Dict[str, List[float]] = {}
    for r in report_rows(report):
        name = row_dim(r, 0).strip().lower()
        key = {"date_range_0": "current", "date_range_1": "previous"}.get(name, name)
        if key in ("current", "previous") and key not in found:
            found[key] = [row_metric(r, i) for i in range(n)]
    return (_totals_from_values(found.get("current", [])), _totals_from_values(found.get("previous", [])))


def _ga_date(value: str) -> Optional[str]:
    if not re.fullmatch(r"[0-9]{8}", value or ""):
        return None
    iso = f"{value[:4]}-{value[4:6]}-{value[6:]}"
    try:
        date.fromisoformat(iso)
    except ValueError:
        return None
    return iso


def _report_end(daily_report: Any, today: Optional[date]) -> Optional[date]:
    """The property's today; when the time zone is unknown (no `today`), the
    latest GA date (at most the property's yesterday) may move the UTC-based
    today forward (property ahead of UTC)."""
    if today is not None:
        return today
    latest = None
    for r in report_rows(daily_report):
        iso = _ga_date(row_dim(r, 0))
        if iso and (latest is None or iso > latest):
            latest = iso
    utc_today = datetime.now(timezone.utc).date()
    if latest and date.fromisoformat(latest) + timedelta(days=1) > utc_today:
        return date.fromisoformat(latest) + timedelta(days=1)
    return utc_today


def _sum_rows(report: Any, key_fn: Callable[[dict], Any], metrics: Sequence[str]) -> Dict[Any, Dict[str, float]]:
    agg: Dict[Any, Dict[str, float]] = {}
    for r in report_rows(report):
        k = key_fn(r)
        if k is None:
            continue
        slot = agg.setdefault(k, {m: 0.0 for m in metrics})
        for i, mname in enumerate(metrics):
            slot[mname] += row_metric(r, i)
    return agg


def _ranked(agg: Dict[Any, Dict[str, float]], sort_by: str, limit: int,
            build: Callable[[Any, Dict[str, float]], Dict[str, Any]]) -> List[Dict[str, Any]]:
    items = sorted(agg.items(), key=lambda kv: (-kv[1][sort_by], str(kv[0])))[:limit]
    return [build(k, v) for k, v in items]


def parse_report(days: int, highlight_source: Optional[str], reports: Dict[str, Any],
                 today: Optional[date] = None) -> Dict[str, Any]:
    """The GA part of GET /report from the named reports (see report_requests)."""
    prop_today = _report_end(reports.get("daily"), today)
    result = empty_report(days, highlight_source, prop_today)
    result["time_zone"] = report_time_zone(reports)
    result["totals"], result["previous"] = parse_report_totals(reports.get("totals"))

    daily = _sum_rows(reports.get("daily"), lambda r: _ga_date(row_dim(r, 0)),
                      ("users", "sessions", "page_views"))
    result["daily"] = [{"date": p["date"],
                        "users": to_int(daily.get(p["date"], {}).get("users", 0)),
                        "sessions": to_int(daily.get(p["date"], {}).get("sessions", 0)),
                        "page_views": to_int(daily.get(p["date"], {}).get("page_views", 0))}
                       for p in result["daily"]]

    def lab(i: int) -> Callable[[dict], str]:
        return lambda r: _label(row_dim(r, i))

    result["countries"] = _ranked(
        _sum_rows(reports.get("countries"), lab(0), ("users", "sessions")), "users", 15,
        lambda k, v: {"country": k, "users": to_int(v["users"]), "sessions": to_int(v["sessions"])})
    result["cities"] = _ranked(
        _sum_rows(reports.get("cities"), lambda r: (_label(row_dim(r, 0)), _label(row_dim(r, 1))), ("users",)),
        "users", 10, lambda k, v: {"city": k[0], "country": k[1], "users": to_int(v["users"])})
    result["channels"] = _ranked(
        _sum_rows(reports.get("channels"), lab(0), ("sessions", "users")), "sessions", 20,
        lambda k, v: {"channel": k, "sessions": to_int(v["sessions"]), "users": to_int(v["users"])})
    result["sources"] = _ranked(
        _sum_rows(reports.get("sources"), lambda r: (_label(row_dim(r, 0)), _label(row_dim(r, 1))),
                  ("sessions", "users")), "sessions", 10,
        lambda k, v: {"source": k[0], "medium": k[1], "sessions": to_int(v["sessions"]),
                      "users": to_int(v["users"])})

    # pages: merged per path; the title is the one with the most views
    pages: Dict[str, Dict[str, Any]] = {}
    for r in report_rows(reports.get("pages")):
        path = _label(row_dim(r, 0))
        title = (row_dim(r, 1) or "").strip()
        views, users, secs = row_metric(r, 0), row_metric(r, 1), row_metric(r, 2)
        p = pages.setdefault(path, {"views": 0.0, "users": 0.0, "secs": 0.0, "title": "", "title_views": -1.0})
        p["views"] += views
        p["users"] += users
        p["secs"] += secs
        if title and title != "(not set)" and views > p["title_views"]:
            p["title"], p["title_views"] = title, views
    result["pages"] = [
        {"path": path, "title": p["title"] or path, "views": to_int(p["views"]), "users": to_int(p["users"]),
         "avg_engagement_seconds": round(p["secs"] / p["users"], 1) if p["users"] else 0.0}
        for path, p in sorted(pages.items(), key=lambda kv: (-kv[1]["views"], kv[0]))[:10]
    ]
    result["landing_pages"] = _ranked(
        _sum_rows(reports.get("landing_pages"), lab(0), ("sessions",)), "sessions", 10,
        lambda k, v: {"page": k, "sessions": to_int(v["sessions"])})
    result["devices"] = _ranked(_sum_rows(reports.get("devices"), lab(0), ("users",)), "users", 10,
                                lambda k, v: {"device": k, "users": to_int(v["users"])})
    result["browsers"] = _ranked(_sum_rows(reports.get("browsers"), lab(0), ("users",)), "users", 6,
                                 lambda k, v: {"browser": k, "users": to_int(v["users"])})
    result["os"] = _ranked(_sum_rows(reports.get("os"), lab(0), ("users",)), "users", 6,
                           lambda k, v: {"os": k, "users": to_int(v["users"])})

    nvr = _sum_rows(reports.get("new_vs_returning"), lambda r: row_dim(r, 0).strip().lower() or None, ("users",))
    result["new_vs_returning"] = [{"type": t, "users": to_int(nvr.get(t, {}).get("users", 0))}
                                  for t in ("new", "returning")]
    result["events"] = _ranked(
        _sum_rows(reports.get("events"), lambda r: (row_dim(r, 0) or "").strip() or None, ("count",)),
        "count", 15, lambda k, v: {"event": k, "count": to_int(v["count"])})

    if (highlight_source or "").strip():
        et = reports.get("email_totals")
        result["email_ga"] = {
            "sessions": to_int(report_total(et, 0)),
            "users": to_int(report_total(et, 1)),
            "key_events": to_int(report_total(et, 2)),
            "by_campaign": _ranked(
                _sum_rows(reports.get("email_by_campaign"), lab(0), ("sessions",)), "sessions", 20,
                lambda k, v: {"campaign": k, "sessions": to_int(v["sessions"])}),
            "by_sender": _ranked(
                _sum_rows(reports.get("email_by_sender"), lab(0), ("sessions",)), "sessions", 20,
                lambda k, v: {"sender": k, "sessions": to_int(v["sessions"])}),
        }
    return result


def run_report_batches(session: Any, property_id: str, named: List[Tuple[str, dict]]) -> Dict[str, Any]:
    """batchRunReports for (name, request) pairs: groups of at most 5, the
    groups requested in parallel (bounded by _MAX_PARALLEL). {name: report}."""
    pid = require_property_id(property_id)
    groups = chunks(named)
    url = f"{DATA_API}/properties/{pid}:batchRunReports"
    answers = run_parallel({
        f"batch{i}": functools.partial(_call, session, "POST", url, {"requests": [body for _, body in group]})
        for i, group in enumerate(groups)
    })
    reports: Dict[str, Any] = {}
    for i, group in enumerate(groups):
        data = answers.get(f"batch{i}") or {}
        got = data.get("reports") if isinstance(data.get("reports"), list) else []
        for j, (name, _) in enumerate(group):
            reports[name] = got[j] if j < len(got) and isinstance(got[j], dict) else {}
    return reports


def fetch_report(session: Any, property_id: str, days: int, highlight_source: Optional[str]) -> Dict[str, Any]:
    """The website report: up to 16 reports in 4 batches, requested in
    parallel. Dates follow the property's own time zone (GA metadata)."""
    reports = run_report_batches(session, property_id, report_requests(days, highlight_source))
    today = property_today(report_time_zone(reports))
    return parse_report(days, highlight_source, reports, today=today)


# ---------------------------------------------------------------------------
# Cache (in-process, keyed by brand first - docs/MULTIBRAND.md rule 5)
# ---------------------------------------------------------------------------

CacheKey = Tuple[Hashable, ...]


class TTLCache:
    """Tiny thread-safe cache. Keys MUST start with the brand id.

    Keeps the last good value past its TTL so a quota / transient error can
    serve it (cached: true), and remembers errors (NEGATIVE_TTL, or
    LASTING_ERROR_TTL for errors only an admin can fix) so a broken
    connection is not retried on every dashboard poll.
    """

    def __init__(self, max_entries: int = 2000, clock: Callable[[], float] = time.monotonic):
        self._values: Dict[CacheKey, Tuple[float, Any]] = {}
        self._errors: Dict[CacheKey, Tuple[float, str, str]] = {}
        self._key_locks: Dict[CacheKey, threading.Lock] = {}
        self._lock = threading.Lock()
        self._max = max_entries
        self._clock = clock

    def get(self, key: CacheKey, ttl: float) -> Any:
        with self._lock:
            item = self._values.get(key)
            if item and self._clock() - item[0] < ttl:
                return copy.deepcopy(item[1])
        return None

    def get_stale(self, key: CacheKey) -> Any:
        with self._lock:
            item = self._values.get(key)
            return copy.deepcopy(item[1]) if item else None

    def set(self, key: CacheKey, value: Any) -> None:
        with self._lock:
            self._values[key] = (self._clock(), copy.deepcopy(value))
            self._errors.pop(key, None)
            if len(self._values) > self._max:
                oldest = sorted(self._values.items(), key=lambda kv: kv[1][0])[: len(self._values) - self._max]
                for k, _ in oldest:
                    self._values.pop(k, None)

    def get_error(self, key: CacheKey, ttl: Optional[float] = None) -> Optional[GAError]:
        """The remembered error, while younger than `ttl` (default: per code,
        see negative_ttl)."""
        with self._lock:
            item = self._errors.get(key)
            if item and self._clock() - item[0] < (negative_ttl(item[1]) if ttl is None else ttl):
                return GAError(item[1], item[2])
        return None

    def set_error(self, key: CacheKey, err: GAError) -> None:
        with self._lock:
            self._errors[key] = (self._clock(), err.code, err.message)
            if len(self._errors) > self._max:
                oldest = sorted(self._errors.items(), key=lambda kv: kv[1][0])[: len(self._errors) - self._max]
                for k, _ in oldest:
                    self._errors.pop(k, None)

    def key_lock(self, key: CacheKey) -> threading.Lock:
        with self._lock:
            lk = self._key_locks.get(key)
            if lk is None:
                if len(self._key_locks) > 2 * self._max:
                    self._key_locks = {k: v for k, v in self._key_locks.items() if v.locked()}
                lk = self._key_locks[key] = threading.Lock()
            return lk

    def invalidate_brand(self, brand_id: Any) -> None:
        b = str(brand_id)
        with self._lock:
            for store in (self._values, self._errors):
                for k in [k for k in store if k and str(k[0]) == b]:
                    store.pop(k, None)

    def clear(self) -> None:
        with self._lock:
            self._values.clear()
            self._errors.clear()
            self._key_locks.clear()


CACHE = TTLCache()

_SLOW_MESSAGE = "Google Analytics is answering slowly. The numbers refresh on their own in a moment."


def invalidate_brand(brand_id: Any) -> None:
    """Forget everything cached for one brand: report data, remembered
    errors and the in-memory access token. Call it whenever the brand's
    connection or settings change."""
    CACHE.invalidate_brand(brand_id)
    CREDENTIALS.invalidate_brand(brand_id)


def cached(key: CacheKey, ttl: float, fetch: Callable[[], Any],
           cache: Optional[TTLCache] = None,
           lock_wait: float = LOCK_WAIT) -> Tuple[Any, bool, Optional[GAError]]:
    """(value, served_from_cache, error).

    * fresh hit                       -> (value, True, None)
    * miss                            -> fetch(); (value, False, None)
    * transient error + older value   -> (old value, True, error)
    * any other error                 -> raises GAError (remembered, see negative_ttl)

    One fetch per key at a time: concurrent pollers of the same brand wait
    for the first one instead of all calling Google - but only `lock_wait`
    seconds. If Google is slow they get the last good value (or an
    upstream_error) instead of holding a worker thread for the whole fetch.
    """
    c = cache or CACHE
    hit = c.get(key, ttl)
    if hit is not None:
        return hit, True, None
    lk = c.key_lock(key)
    if not lk.acquire(timeout=lock_wait):
        busy = GAError(UPSTREAM_ERROR, _SLOW_MESSAGE)
        stale = c.get_stale(key)
        if stale is not None:
            return stale, True, busy
        raise busy
    try:
        hit = c.get(key, ttl)
        if hit is not None:
            return hit, True, None
        err = c.get_error(key)
        if err is None:
            try:
                value = fetch()
            except GAError as e:
                err = e
            except Exception as exc:  # defensive: never leak an unexpected exception's text
                log.warning("GA fetch failed unexpectedly: %s", type(exc).__name__)
                err = GAError(UPSTREAM_ERROR)
            else:
                c.set(key, value)
                return copy.deepcopy(value), False, None
            c.set_error(key, err)
        if err.code in STALE_OK_CODES:
            stale = c.get_stale(key)
            if stale is not None:
                return stale, True, err
        raise err
    finally:
        lk.release()
