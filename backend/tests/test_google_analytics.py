"""
Unit tests for the Google Analytics 4 integration.

    backend/integrations/google_analytics.py
    backend/api/routers/integrations_google_analytics.py

No network and no database: Google is replaced by fake sessions / fake HTTP
objects, the router's execute_sql by an in-memory fake, and any real HTTP
attempt fails the test. Run from the repo root:

    python -m pytest backend/tests/test_google_analytics.py -q

(the backend image has every dependency; it does not ship pytest, so
`pip install pytest` first when running inside it).
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import jwt as pyjwt  # noqa: E402
import requests  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from psycopg.types.json import Jsonb  # noqa: E402
from starlette.requests import Request  # noqa: E402

from api.routers import email_accounts  # noqa: E402
from api.routers import integrations_google_analytics as gar  # noqa: E402
from database import brands as brand_catalog  # noqa: E402
from database import tenancy  # noqa: E402
from integrations import google_analytics as ga  # noqa: E402
from integrations.google_analytics import GAError  # noqa: E402

# Placeholders only - nothing here is (or looks like) a real Google credential.
FAKE_REFRESH = "test-refresh-token-not-real-7c1e"
CLIENT_ID = "test-client-id"
CLIENT_SECRET = "test-client-secret-not-real"
BRAND = "00000000-0000-0000-0000-00000000b001"
OTHER_BRAND = "00000000-0000-0000-0000-00000000b002"
USER_ID = "00000000-0000-0000-0000-00000000c001"
PROPERTY = "123456789"
BRAND_ROW = {"id": BRAND, "slug": "example-brand", "display_name": "Example Brand", "hostnames": [],
             "is_active": True, "sender": {"utm_source": "example-outreach"}, "branding": {}}
ADMIN = {"id": USER_ID, "email": "you@example.com", "brand_id": BRAND, "brand_role": "admin", "role": "admin",
         "is_platform_admin": False}
VIEWER = dict(ADMIN, brand_role="viewer", role="viewer")


# ---------------------------------------------------------------------------
# fixtures / fakes
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", CLIENT_SECRET)
    monkeypatch.setenv("JWT_SECRET", "unit-test-jwt-secret-not-real-0123456789abcdef")
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://reach.example.com")
    monkeypatch.setenv("FRONTEND_URL", "https://app.example.com")
    monkeypatch.delenv("BACKEND_URL", raising=False)

    attempts: List[str] = []

    def no_network(_self, method, url, *_a, **_k):
        attempts.append(f"{method} {url}")
        raise AssertionError("unit tests must not make real HTTP requests")

    # Any real HTTP attempt is recorded (the provider maps transport errors,
    # so a bare raise could be swallowed) and fails the test at teardown.
    monkeypatch.setattr(requests.sessions.Session, "request", no_network)
    monkeypatch.setattr(ga, "CACHE", ga.TTLCache())
    monkeypatch.setattr(ga, "CREDENTIALS", ga.CredentialsCache())
    monkeypatch.setattr(brand_catalog, "get_brand", lambda ref: dict(BRAND_ROW) if str(ref) == BRAND else None)
    tok = tenancy.set_current_brand(BRAND)
    yield
    tenancy.reset_current_brand(tok)
    assert not attempts, f"real HTTP attempted: {attempts}"


class FakeResponse:
    def __init__(self, status: int, payload: Any):
        self.status_code = status
        self._payload = payload

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class FakeSession:
    """Stands in for google.auth AuthorizedSession (shared by the parallel
    report calls, like the real one)."""

    def __init__(self, handler: Callable[[str, str, Optional[dict]], Any]):
        self.handler = handler
        self.calls: List[tuple] = []
        self.closed = 0

    def request(self, method, url, json=None, timeout=None, **_kw):
        assert timeout == ga.HTTP_TIMEOUT
        self.calls.append((method, url, json))
        out = self.handler(method, url, json)
        if isinstance(out, BaseException):
            raise out
        return out

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        self.closed += 1
        return False


def row(dims: List[str], mets: List[str]) -> dict:
    return {"dimensionValues": [{"value": d} for d in dims], "metricValues": [{"value": m} for m in mets]}


def realtime_handler(method, url, body):
    assert method == "POST" and url.endswith(f"/properties/{PROPERTY}:runRealtimeReport")
    dims = [d["name"] for d in (body or {}).get("dimensions", [])]
    if not dims:
        return FakeResponse(200, {"rows": [row([], ["7"])]})
    if dims == ["minutesAgo"]:
        return FakeResponse(200, {"rows": [row(["03"], ["2"]), row(["00"], ["5"]), row(["45"], ["9"]),
                                           row(["xx"], ["1"])]})
    if dims == ["unifiedScreenName"]:
        return FakeResponse(200, {"rows": [row(["Pricing"], ["2"]), row(["Home"], ["4"]), row([""], ["1"])]})
    if dims == ["country"]:
        return FakeResponse(200, {"rows": [row(["Exampleland"], ["5"])]})
    if dims == ["deviceCategory"]:
        return FakeResponse(200, {})  # GA omits "rows" when a report is empty
    raise AssertionError(dims)


def google_error(status: int, gstatus: str, message: str, reason: Optional[str] = None,
                 service: Optional[str] = None) -> FakeResponse:
    err: Dict[str, Any] = {"code": status, "status": gstatus, "message": message}
    if reason:
        detail: Dict[str, Any] = {"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": reason}
        if service:
            detail["metadata"] = {"service": service}
        err["details"] = [detail]
    return FakeResponse(status, {"error": err})


class FakeDB:
    """In-memory stand-in for the router's execute_sql. Also asserts the
    multi-brand rule: SQL on brand_integrations outside system_scope always
    filters by the active brand."""

    def __init__(self):
        self.rows: Dict[str, dict] = {}
        self.mailboxes: set = set()
        self.users: Dict[str, dict] = {USER_ID: {"id": USER_ID, "is_active": True, "is_platform_admin": False}}
        self.statements: List[tuple] = []

    def __call__(self, sql: str, params=None):
        params = list(params or [])
        s = " ".join(sql.split())
        system = tenancy.in_system_scope()
        self.statements.append((s, params, tenancy.current_brand(), system))
        if "brand_integrations" in s and not system:
            assert "brand_id" in s, s
            assert tenancy.current_brand() in params, (s, tenancy.current_brand())
        if s.startswith("SELECT id, brand_id, provider"):
            r = self.rows.get(params[0])
            return [dict(r)] if r and r["provider"] == params[1] else []
        if s.startswith("UPDATE brand_integrations SET"):
            cols = re.findall(r"(\w+) = %s", s.split(" WHERE ")[0])
            r = self.rows.get(params[-2])
            if r:
                for col, val in zip(cols, params):
                    r[col] = val.obj if isinstance(val, Jsonb) else val
            return []
        if s.startswith("INSERT INTO brand_integrations"):
            brand_id, provider, config, token, email, uid = params
            r = self.rows.get(brand_id) or {"id": f"row-{brand_id}"}
            r.update(brand_id=brand_id, provider=provider, config=config.obj, refresh_token=token,
                     account_email=email, status="connected", last_error=None, connected_by=uid)
            self.rows[brand_id] = r
            return [{"id": r["id"]}]
        if s.startswith("DELETE FROM brand_integrations"):
            self.rows.pop(params[0], None)
            return []
        if "FROM email_accounts" in s:
            return [{"x": 1}] if params[0].lower() in self.mailboxes else []
        if s.startswith("SELECT 1 FROM brand_integrations"):
            email, brand_id = params
            return [{"x": 1} for b, r in self.rows.items()
                    if b != brand_id and (r.get("account_email") or "").lower() == email.lower()
                    and r.get("refresh_token")]
        if "FROM sales_reps" in s:
            u = self.users.get(params[0])
            return [dict(u)] if u else []
        raise AssertionError(f"unexpected SQL: {s}")


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    monkeypatch.setattr(gar, "execute_sql", fake)
    return fake


def connected_row(**over) -> dict:
    r = {"id": "row-1", "brand_id": BRAND, "provider": "google_analytics",
         "config": {"property_id": PROPERTY, "property_name": "Example site", "show_on_dashboard": True},
         "refresh_token": FAKE_REFRESH, "account_email": "you@example.com", "status": "connected",
         "last_error": None, "connected_by": USER_ID, "created_at": "2026-01-01T00:00:00+00:00",
         "updated_at": "2026-01-01T00:00:00+00:00"}
    r.update(over)
    return r


def make_request(path: str = "/") -> Request:
    return Request({"type": "http", "method": "GET", "path": path, "query_string": b"",
                    "headers": [(b"host", b"reach.example.com")]})


def use_session(monkeypatch, handler) -> FakeSession:
    session = FakeSession(handler)

    def factory(token, brand_id):
        assert token == FAKE_REFRESH and brand_id == BRAND
        return session

    monkeypatch.setattr(ga, "authorized_session", factory)
    return session


def run(coro):
    return asyncio.run(coro)


def location(resp) -> str:
    return resp.headers["location"]


# ---------------------------------------------------------------------------
# provider: parsing
# ---------------------------------------------------------------------------

def test_scopes_are_read_only_analytics_plus_identity():
    assert ga.SCOPES == ["https://www.googleapis.com/auth/analytics.readonly", "openid",
                         "https://www.googleapis.com/auth/userinfo.email"]


def test_authorization_url_does_not_include_granted_scopes():
    from urllib.parse import parse_qs, urlparse

    flow = ga.build_oauth_flow("https://reach.example.com" + gar.CALLBACK_PATH)
    url = ga.authorization_url(flow, "signed-state")
    q = parse_qs(urlparse(url).query)
    assert "include_granted_scopes" not in q
    assert q["access_type"] == ["offline"]
    assert q["prompt"] == ["select_account consent"]  # account chooser for "Switch account" + refresh token
    assert "analytics.readonly" in q["scope"][0]
    assert "code_challenge" not in q  # no PKCE: exchange_code sends no code_verifier
    assert flow.autogenerate_code_verifier is False


def test_gmail_connect_accepts_the_scope_union_after_ga_connect(monkeypatch):
    """Regression: Gmail's consent uses include_granted_scopes, so once an
    account connected GA, Google's token response for the Gmail flow also
    lists analytics.readonly. oauthlib refuses that unless
    OAUTHLIB_RELAX_TOKEN_SCOPE is set - which api/main.py does at startup."""
    from google_auth_oauthlib.flow import Flow

    def gmail_flow():
        config = {"web": {"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET,
                          "auth_uri": ga.AUTH_URI, "token_uri": ga.TOKEN_URI,
                          "redirect_uris": ["https://reach.example.com/api/email-accounts/google/callback"]}}
        flow = Flow.from_client_config(config, scopes=email_accounts.GMAIL_SCOPES,
                                       redirect_uri=config["web"]["redirect_uris"][0])
        union = " ".join(email_accounts.GMAIL_SCOPES + [ga.ANALYTICS_SCOPE])

        def token_endpoint(method, url, **_kw):
            resp = requests.Response()
            resp.status_code = 200
            resp._content = json.dumps({"access_token": "test-access-not-real", "token_type": "Bearer",
                                        "expires_in": 3599, "refresh_token": FAKE_REFRESH,
                                        "scope": union}).encode()
            resp.headers["Content-Type"] = "application/json"
            resp.request = requests.Request(method, url).prepare()
            return resp

        monkeypatch.setattr(flow.oauth2session, "request", token_endpoint)
        return flow

    monkeypatch.delenv("OAUTHLIB_RELAX_TOKEN_SCOPE", raising=False)  # restored after the test
    try:
        with pytest.raises(Warning, match="Scope has changed"):
            gmail_flow().fetch_token(code="test-code")  # the bug, without the setting

        ga.allow_google_scope_union()
        token = gmail_flow().fetch_token(code="test-code")
        assert token["refresh_token"] == FAKE_REFRESH
    finally:
        os.environ.pop("OAUTHLIB_RELAX_TOKEN_SCOPE", None)

    main_py = (BACKEND / "api" / "main.py").read_text()
    assert re.search(r"^allow_google_scope_union\(\)$", main_py, re.M), "api/main.py must call it at startup"


def test_parse_account_summaries_is_defensive():
    data = {"accountSummaries": [
        {"displayName": "Example Account", "propertySummaries": [
            {"property": "properties/123456789", "displayName": "Example site"},
            {"property": "properties/abc", "displayName": "bad id"},
            {"displayName": "no property field"},
            {"property": "properties/987", "displayName": ""},
        ]},
        {"displayName": "Empty Account"},
        "garbage",
    ]}
    assert ga.parse_account_summaries(data) == [
        {"property_id": "123456789", "display_name": "Example site", "account_name": "Example Account"},
        {"property_id": "987", "display_name": "Property 987", "account_name": "Example Account"},
    ]
    assert ga.parse_account_summaries({}) == []
    assert ga.parse_account_summaries(None) == []


def test_list_properties_follows_pagination():
    pages = {
        None: {"accountSummaries": [{"displayName": "B", "propertySummaries": [
            {"property": "properties/2", "displayName": "Two"}]}], "nextPageToken": "next/page=1"},
        "next/page=1": {"accountSummaries": [{"displayName": "A", "propertySummaries": [
            {"property": "properties/1", "displayName": "One"},
            {"property": "properties/2", "displayName": "Two again"}]}]},
    }

    def handler(method, url, body):
        assert method == "GET" and url.startswith(ga.ADMIN_API + "/accountSummaries?pageSize=200")
        token = None
        if "pageToken=" in url:
            from urllib.parse import unquote
            token = unquote(url.split("pageToken=")[1])
        return FakeResponse(200, pages[token])

    session = FakeSession(handler)
    props = ga.list_properties(session)
    assert [p["property_id"] for p in props] == ["1", "2"]  # sorted by account, de-duplicated
    assert len(session.calls) == 2


def test_realtime_zero_fills_minutes_and_handles_missing_rows():
    session = FakeSession(realtime_handler)
    data = ga.fetch_realtime(session, PROPERTY)
    assert data["active_users"] == 7
    assert [p["minutes_ago"] for p in data["per_minute"]] == list(range(30))
    users = {p["minutes_ago"]: p["users"] for p in data["per_minute"]}
    assert users[0] == 5 and users[3] == 2 and sum(users.values()) == 7  # "45" and "xx" ignored
    assert data["top_pages"] == [{"name": "Home", "users": 4}, {"name": "Pricing", "users": 2},
                                 {"name": "(not set)", "users": 1}]
    assert data["countries"] == [{"name": "Exampleland", "users": 5}]
    assert data["devices"] == []
    assert len(session.calls) == 5
    for _, _, body in session.calls:  # realtime has no source / campaign dimensions
        assert all(d["name"] in ("minutesAgo", "unifiedScreenName", "country", "deviceCategory")
                   for d in body.get("dimensions", []))


def test_realtime_all_empty():
    data = ga.fetch_realtime(FakeSession(lambda m, u, b: FakeResponse(200, {})), PROPERTY)
    assert data["active_users"] == 0
    assert data["per_minute"] == [{"minutes_ago": m, "users": 0} for m in range(30)]
    assert data["top_pages"] == [] and data["countries"] == [] and data["devices"] == []


def test_date_range():
    assert ga.date_range(1) == {"startDate": "today", "endDate": "today"}
    assert ga.date_range(7) == {"startDate": "6daysAgo", "endDate": "today"}
    assert ga.date_range(90) == {"startDate": "89daysAgo", "endDate": "today"}
    with pytest.raises(ValueError):
        ga.date_range(3)


def summary_handler(method, url, body):
    assert method == "POST" and url.endswith(f"/properties/{PROPERTY}:batchRunReports")
    assert 1 <= len(body["requests"]) <= 5
    reports = []
    for req in body["requests"]:
        dims = [d["name"] for d in req.get("dimensions", [])]
        filtered = "dimensionFilter" in req
        if not dims and not filtered:
            reports.append({"rows": [row([], ["120", "80", "6", "0.5432"])]})
        elif dims == ["sessionSource", "sessionMedium"]:
            reports.append({"rows": [row(["google", "organic"], ["60", "50"]),
                                     row(["example-outreach", "email"], ["30", "20"])]})
        elif not dims and filtered:
            reports.append({"rows": [row([], ["30", "20", "4"])]})
        elif dims == ["sessionCampaignName"]:
            reports.append({"rows": [row(["spring_launch"], ["20", "15", "3"]), row(["(not set)"], ["10", "5", "1"])]})
        elif dims == ["sessionManualTerm"]:
            reports.append({"rows": [row(["sam_lee"], ["25", "18", "4.0"])]})
        elif dims == ["date"]:
            reports.append({"rows": [row(["20261118"], ["10"]), row(["20261120"], ["20"])]})
        elif dims == ["landingPage"]:
            reports.append({})  # empty report -> no rows key
        else:
            raise AssertionError(dims)
    return FakeResponse(200, {"reports": reports})


def test_summary_batches_filter_and_parse():
    session = FakeSession(summary_handler)
    data = ga.fetch_summary(session, PROPERTY, 7, "Example-Outreach")
    assert sorted(len(c[2]["requests"]) for c in session.calls) == [2, 5]  # 2 batches, sent in parallel
    filtered = [r for c in session.calls for r in c[2]["requests"] if "dimensionFilter" in r]
    assert len(filtered) == 5
    for r in filtered:
        sf = r["dimensionFilter"]["filter"]
        assert sf["fieldName"] == "sessionSource"
        assert sf["stringFilter"] == {"matchType": "EXACT", "value": "Example-Outreach", "caseSensitive": False}
    for c in session.calls:
        for r in c[2]["requests"]:
            assert r["dateRanges"] == [{"startDate": "6daysAgo", "endDate": "today"}]

    assert data["totals"] == {"sessions": 120, "users": 80, "key_events": 6, "engagement_rate": 0.5432}
    assert data["sources"][0] == {"source": "google", "medium": "organic", "sessions": 60, "users": 50}
    email = data["email"]
    assert email["totals"] == {"sessions": 30, "users": 20, "key_events": 4}
    assert email["by_campaign"][0] == {"campaign": "spring_launch", "sessions": 20, "users": 15, "key_events": 3}
    assert email["by_sender"] == [{"sender": "sam_lee", "sessions": 25, "users": 18, "key_events": 4}]
    assert email["landing_pages"] == []
    assert len(email["daily"]) >= 7 and all(set(d) == {"date", "sessions"} for d in email["daily"])


def test_summary_without_highlight_source_skips_email_panel():
    session = FakeSession(summary_handler)
    data = ga.fetch_summary(session, PROPERTY, 30, "")
    assert len(session.calls) == 1 and len(session.calls[0][2]["requests"]) == 2
    assert data["email"] == ga.empty_email_panel()
    assert data["highlight_source"] is None


def test_summary_daily_series_follows_the_property_time_zone(monkeypatch):
    """GA's "today" is the property's date. At 20:00 UTC on Feb 28 a UTC+8
    property is already on Feb 29, so the last 7 days are Feb 23..29.
    (IANA "Etc/GMT-8" is UTC+8 - the POSIX sign is inverted.)"""
    from datetime import date, datetime, timezone as tz

    now = datetime(2024, 2, 28, 20, 0, tzinfo=tz.utc)
    assert ga.property_today("Etc/GMT-8", now) == date(2024, 2, 29)
    assert ga.property_today("Etc/GMT+8", now) == date(2024, 2, 28)
    assert ga.property_today("Not/AZone", now) is None and ga.property_today(None, now) is None
    assert ga.report_time_zone({"a": {}, "b": {"metadata": {"timeZone": "Etc/GMT-8"}}}) == "Etc/GMT-8"
    assert ga.report_time_zone({"a": {"metadata": {}}}) is None

    def handler(method, url, body):
        reports = []
        for req in body["requests"]:
            dims = [d["name"] for d in req.get("dimensions", [])]
            rep: Dict[str, Any] = {"metadata": {"timeZone": "Etc/GMT-8", "currencyCode": "USD"}}
            if dims == ["date"]:
                rep["rows"] = [row(["20240227"], ["10"]), row(["20240229"], ["20"])]
            reports.append(rep)
        return FakeResponse(200, {"reports": reports})

    real_today = ga.property_today
    monkeypatch.setattr(ga, "property_today", lambda tz_name: real_today(tz_name, now))
    data = ga.fetch_summary(FakeSession(handler), PROPERTY, 7, "example-outreach")
    assert data["email"]["daily"] == [
        {"date": "2024-02-23", "sessions": 0}, {"date": "2024-02-24", "sessions": 0},
        {"date": "2024-02-25", "sessions": 0}, {"date": "2024-02-26", "sessions": 0},
        {"date": "2024-02-27", "sessions": 10}, {"date": "2024-02-28", "sessions": 0},
        {"date": "2024-02-29", "sessions": 20},
    ]


def test_daily_series_zero_fills():
    from datetime import date
    report = {"rows": [row(["20261118"], ["10"]), row(["20261120"], ["20"]), row(["bad"], ["5"])]}
    out = ga.daily_series(report, 7, today=date(2026, 11, 20))
    assert [d["date"] for d in out] == ["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17",
                                        "2026-11-18", "2026-11-19", "2026-11-20"]
    assert [d["sessions"] for d in out] == [0, 0, 0, 0, 10, 0, 20]
    assert ga.daily_series({}, 1, today=date(2026, 11, 20)) == [{"date": "2026-11-20", "sessions": 0}]


def test_metric_values_parse_defensively():
    assert ga.to_int("12") == 12 and ga.to_int("3.0") == 3 and ga.to_int(None) == 0
    assert ga.to_number("nan") == 0.0 and ga.to_number("abc") == 0.0
    assert ga.report_total({"rows": []}) == 0.0 and ga.report_total(None) == 0.0
    assert ga.row_metric({"metricValues": []}, 2) == 0.0 and ga.row_dim({}, 0) == ""


# ---------------------------------------------------------------------------
# provider: error mapping
# ---------------------------------------------------------------------------

def _err(resp) -> GAError:
    with pytest.raises(GAError) as exc:
        ga._call(FakeSession(lambda m, u, b: resp), "POST", ga.DATA_API + "/properties/1:runRealtimeReport", {})
    return exc.value


def test_api_disabled_tells_admin_which_apis_to_enable():
    e = _err(google_error(403, "PERMISSION_DENIED",
                          "Google Analytics Data API has not been used in project 123456789 before or it is "
                          "disabled.", "SERVICE_DISABLED", "analyticsdata.googleapis.com"))
    assert e.code == "api_disabled"
    assert '"Google Analytics Data API"' in e.message and '"Google Analytics Admin API"' in e.message
    assert "123456789" not in e.message  # Google's raw text (project number) is not echoed

    legacy = _err(FakeResponse(403, {"error": {"code": 403, "message": "Access Not Configured.",
                                               "errors": [{"reason": "accessNotConfigured"}]}}))
    assert legacy.code == "api_disabled"


def test_permission_quota_property_and_upstream_mapping():
    denied = google_error(403, "PERMISSION_DENIED", "User does not have sufficient permissions for this property.")
    assert _err(denied).code == "permission_denied"
    assert _err(google_error(429, "RESOURCE_EXHAUSTED", "Exhausted property tokens.")).code == "quota_exceeded"
    assert _err(google_error(403, "PERMISSION_DENIED", "Rate limited.", "RATE_LIMIT_EXCEEDED")).code == "quota_exceeded"
    assert _err(google_error(400, "INVALID_ARGUMENT", "Invalid property ID: properties/0")).code == "invalid_property"
    assert _err(google_error(404, "NOT_FOUND", "not found")).code == "invalid_property"
    assert _err(google_error(400, "INVALID_ARGUMENT", "Field foo is not a valid dimension.")).code == "upstream_error"
    assert _err(google_error(500, "INTERNAL", "boom")).code == "upstream_error"
    assert _err(FakeResponse(502, ValueError("not json"))).code == "upstream_error"
    assert _err(google_error(403, "PERMISSION_DENIED", "Request had insufficient authentication scopes.",
                             "ACCESS_TOKEN_SCOPE_INSUFFICIENT")).code == "reconnect_required"
    assert _err(google_error(401, "UNAUTHENTICATED", "Invalid credentials")).code == "reconnect_required"


def test_invalid_grant_maps_to_reconnect_required_without_leaking_secrets():
    from google.auth.exceptions import RefreshError

    exc = RefreshError(f"invalid_grant: Token has been expired or revoked. {FAKE_REFRESH}",
                       {"error": "invalid_grant"})
    e = _err(exc)
    assert e.code == "reconnect_required"
    assert FAKE_REFRESH not in e.message and FAKE_REFRESH not in str(e)

    other = _err(RefreshError("invalid_client: The OAuth client was not found.", {}))
    assert other.code == "not_configured"


def test_transport_errors_map_to_upstream():
    assert _err(requests.Timeout("timed out")).code == "upstream_error"
    assert _err(requests.ConnectionError("dns")).code == "upstream_error"


def test_realtime_requests_run_in_parallel_and_errors_are_deterministic():
    barrier = threading.Barrier(5, timeout=5)

    def handler(method, url, body):
        barrier.wait()  # only returns once all 5 requests are in flight at the same time
        return realtime_handler(method, url, body)

    data = ga.fetch_realtime(FakeSession(handler), PROPERTY)
    assert data["active_users"] == 7

    def failing(method, url, body):
        dims = [d["name"] for d in (body or {}).get("dimensions", [])]
        if dims == ["country"]:
            return google_error(429, "RESOURCE_EXHAUSTED", "Exhausted")
        if dims == ["minutesAgo"]:
            time.sleep(0.05)  # finishes last, but comes first in request order
            return google_error(403, "PERMISSION_DENIED", "no access")
        return realtime_handler(method, url, body)

    with pytest.raises(GAError) as exc:
        ga.fetch_realtime(FakeSession(failing), PROPERTY)
    assert exc.value.code == "permission_denied"


# ---------------------------------------------------------------------------
# provider: OAuth code exchange / revoke
# ---------------------------------------------------------------------------

class FakeHTTP:
    def __init__(self, post_resp=None, get_resp=None):
        self.post_resp, self.get_resp = post_resp, get_resp
        self.posts: List[tuple] = []

    def post(self, url, data=None, headers=None, timeout=None):
        assert timeout == ga.HTTP_TIMEOUT
        self.posts.append((url, data))
        if isinstance(self.post_resp, BaseException):
            raise self.post_resp
        return self.post_resp

    def get(self, url, headers=None, timeout=None):
        assert timeout == ga.HTTP_TIMEOUT
        return self.get_resp


def _id_token(**claims) -> str:
    base = {"iss": "https://accounts.google.com", "aud": CLIENT_ID, "email": "you@example.com"}
    base.update(claims)
    return pyjwt.encode(base, "unit-test-signing-key-not-real-0123456789", algorithm="HS256")


def test_exchange_code_reads_scopes_email_and_refresh_token():
    http = FakeHTTP(FakeResponse(200, {"access_token": "test-access-not-real", "refresh_token": FAKE_REFRESH,
                                       "scope": " ".join(ga.SCOPES), "id_token": _id_token()}))
    out = ga.exchange_code("https://reach.example.com/cb", "test-code", http=http)
    assert out == {"refresh_token": FAKE_REFRESH, "scopes": ga.SCOPES, "email": "you@example.com"}
    url, data = http.posts[0]
    assert url == ga.TOKEN_URI and data["grant_type"] == "authorization_code"
    assert data["redirect_uri"] == "https://reach.example.com/cb"


def test_exchange_code_rejects_foreign_id_token_and_falls_back_to_userinfo():
    http = FakeHTTP(FakeResponse(200, {"access_token": "test-access-not-real", "scope": "openid",
                                       "id_token": _id_token(aud="someone-else")}),
                    FakeResponse(200, {"email": "other@example.com"}))
    out = ga.exchange_code("https://reach.example.com/cb", "test-code", http=http)
    assert out["email"] == "other@example.com" and out["refresh_token"] is None
    assert ga.ANALYTICS_SCOPE not in out["scopes"]


def test_exchange_code_error_is_generic():
    http = FakeHTTP(FakeResponse(400, {"error": "invalid_grant", "error_description": "Bad Request"}))
    with pytest.raises(GAError) as exc:
        ga.exchange_code("https://reach.example.com/cb", "test-code", http=http)
    assert exc.value.code == "upstream_error"
    with pytest.raises(GAError):
        ga.exchange_code("https://reach.example.com/cb", "test-code", http=FakeHTTP(requests.Timeout()))


def test_revoke_is_best_effort():
    assert ga.revoke_token(FAKE_REFRESH, http=FakeHTTP(FakeResponse(200, {}))) is True
    assert ga.revoke_token(FAKE_REFRESH, http=FakeHTTP(FakeResponse(400, {}))) is False
    assert ga.revoke_token(FAKE_REFRESH, http=FakeHTTP(requests.ConnectionError())) is False
    assert ga.revoke_token("", http=FakeHTTP()) is False


def test_not_configured_without_env(monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID")
    assert ga.is_configured() is False
    with pytest.raises(GAError) as exc:
        ga.build_oauth_flow("https://reach.example.com/cb")
    assert exc.value.code == "not_configured"


# ---------------------------------------------------------------------------
# provider: cache
# ---------------------------------------------------------------------------

class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_cache_fresh_stale_negative_and_brand_scoped():
    clock = Clock()
    cache = ga.TTLCache(clock=clock)
    calls = []

    def ok():
        calls.append("ok")
        return {"active_users": 3}

    key = (BRAND, "realtime", PROPERTY)
    assert ga.cached(key, 30, ok, cache) == ({"active_users": 3}, False, None)
    assert ga.cached(key, 30, ok, cache) == ({"active_users": 3}, True, None)
    assert calls == ["ok"]

    # quota after expiry -> last good value, cached, with the error
    clock.t += 31
    value, was_cached, err = ga.cached(key, 30, lambda: (_ for _ in ()).throw(GAError("quota_exceeded")), cache)
    assert value == {"active_users": 3} and was_cached is True and err.code == "quota_exceeded"

    # an error only an admin can fix is raised, and remembered for
    # LASTING_ERROR_TTL (no re-fetch on every 30 s poll)
    other = (BRAND, "summary", PROPERTY, 7, "x")
    attempts = []

    def denied():
        attempts.append(1)
        raise GAError("permission_denied")

    for _ in range(3):
        with pytest.raises(GAError) as exc:
            ga.cached(other, 300, denied, cache)
        assert exc.value.code == "permission_denied"
        clock.t += ga.NEGATIVE_TTL + 1  # well past the short TTL...
    assert len(attempts) == 1           # ...still not asked again
    clock.t += ga.LASTING_ERROR_TTL
    with pytest.raises(GAError):
        ga.cached(other, 300, denied, cache)
    assert len(attempts) == 2

    # a transient error is only remembered for NEGATIVE_TTL
    flaky = (BRAND, "realtime", "999")
    fails = []

    def upstream():
        fails.append(1)
        raise GAError("upstream_error")

    for _ in range(2):
        with pytest.raises(GAError):
            ga.cached(flaky, 30, upstream, cache)
    assert len(fails) == 1
    clock.t += ga.NEGATIVE_TTL + 1
    with pytest.raises(GAError):
        ga.cached(flaky, 30, upstream, cache)
    assert len(fails) == 2
    assert ga.negative_ttl("api_disabled") == ga.negative_ttl("invalid_property") == ga.LASTING_ERROR_TTL
    assert ga.negative_ttl("quota_exceeded") == ga.NEGATIVE_TTL

    # brand isolation: other brand's identical key misses; invalidation is per brand
    assert cache.get((OTHER_BRAND, "realtime", PROPERTY), 10_000) is None
    cache.set((OTHER_BRAND, "realtime", PROPERTY), {"active_users": 99})
    cache.invalidate_brand(BRAND)
    assert cache.get_stale(key) is None
    assert cache.get((OTHER_BRAND, "realtime", PROPERTY), 10_000) == {"active_users": 99}


def test_cache_waits_only_briefly_for_a_slow_fetch():
    """A poller never holds a worker thread for a whole slow Google fetch:
    after lock_wait it gets the last good value (or upstream_error)."""
    clock = Clock()
    cache = ga.TTLCache(clock=clock)
    key = (BRAND, "realtime", PROPERTY)
    started, release = threading.Event(), threading.Event()

    def slow():
        started.set()
        release.wait(5)
        return {"active_users": 2}

    t = threading.Thread(target=ga.cached, args=(key, 30, slow, cache))
    t.start()
    assert started.wait(5)
    with pytest.raises(GAError) as exc:  # nothing cached yet
        ga.cached(key, 30, lambda: pytest.fail("must not fetch twice"), cache, lock_wait=0.05)
    assert exc.value.code == "upstream_error"
    release.set()
    t.join(5)

    clock.t += 31  # expired, but kept as the last good value
    started.clear()
    release.clear()
    t = threading.Thread(target=ga.cached, args=(key, 30, slow, cache))
    t.start()
    assert started.wait(5)
    value, was_cached, err = ga.cached(key, 30, lambda: pytest.fail("must not fetch twice"), cache, lock_wait=0.05)
    assert value == {"active_users": 2} and was_cached is True and err.code == "upstream_error"
    release.set()
    t.join(5)


def test_authorized_session_reuses_the_access_token_per_brand(monkeypatch):
    from datetime import datetime, timedelta, timezone
    from google.oauth2.credentials import Credentials

    refreshes = []

    def fake_refresh(self, request):
        refreshes.append(self.refresh_token)
        self.token = "test-access-not-real"
        self.expiry = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1)  # naive UTC

    monkeypatch.setattr(Credentials, "refresh", fake_refresh)
    for _ in range(3):
        with ga.authorized_session(FAKE_REFRESH, BRAND) as s:
            assert s.credentials.token == "test-access-not-real"
    assert len(refreshes) == 1                      # one token call, then reused
    with ga.authorized_session(FAKE_REFRESH, OTHER_BRAND):
        pass
    assert len(refreshes) == 2                      # never shared across brands
    ga.invalidate_brand(BRAND)
    with ga.authorized_session(FAKE_REFRESH, BRAND):
        pass
    assert len(refreshes) == 3                      # reconnect / disconnect forgets it
    assert all(FAKE_REFRESH not in str(k) for k in ga.CREDENTIALS._items)  # keyed by a hash only


def test_authorized_session_maps_a_revoked_grant(monkeypatch):
    from google.auth.exceptions import RefreshError
    from google.oauth2.credentials import Credentials

    def revoked(self, request):
        raise RefreshError(f"invalid_grant: Token has been expired or revoked. {FAKE_REFRESH}")

    monkeypatch.setattr(Credentials, "refresh", revoked)
    with pytest.raises(GAError) as exc:
        ga.authorized_session(FAKE_REFRESH, BRAND)
    assert exc.value.code == "reconnect_required" and FAKE_REFRESH not in str(exc.value)


def test_cache_returns_copies():
    cache = ga.TTLCache()
    cache.set((BRAND, "k"), {"list": [1]})
    got = cache.get((BRAND, "k"), 60)
    got["list"].append(2)
    assert cache.get((BRAND, "k"), 60) == {"list": [1]}


# ---------------------------------------------------------------------------
# router: validation, state, serialization
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("value", ["123", " 123456789 ", "1" * 20])
def test_property_id_valid(value):
    assert gar.validate_property_id(value) == value.strip()
    assert ga.require_property_id(value) == value.strip()


@pytest.mark.parametrize("value", ["abc", "properties/123", "1" * 21, "12 3", "-1", "1.5", "１２３"])
def test_property_id_invalid(value):
    with pytest.raises(HTTPException) as exc:
        gar.validate_property_id(value)
    assert exc.value.status_code == 400
    with pytest.raises(GAError) as gexc:
        ga.require_property_id(value)
    assert gexc.value.code == "invalid_property"


def test_property_id_empty_clears():
    assert gar.validate_property_id("") is None and gar.validate_property_id(None) is None


def test_state_round_trip_and_purpose_separation():
    state = gar.mint_state(BRAND, USER_ID, "https://brand.example.com")
    claims = gar.verify_state(state)
    assert claims["brand"] == BRAND and claims["uid"] == USER_ID and claims["ret"] == "https://brand.example.com"
    assert claims["purpose"] == "ga_oauth" and "sub" not in claims

    gmail_state = email_accounts._mint_oauth_state(BRAND, USER_ID)
    assert email_accounts._verify_oauth_state(gmail_state) is not None
    assert gar.verify_state(gmail_state) is None            # Gmail state cannot connect GA
    assert email_accounts._verify_oauth_state(state) is None  # and vice versa


def test_state_rejects_tampered_expired_and_token_like():
    from datetime import datetime, timedelta, timezone
    from api.security import JWT_ALGORITHM, get_jwt_secret

    state = gar.mint_state(BRAND, USER_ID)
    assert gar.verify_state(state[:-2] + ("AA" if not state.endswith("AA") else "BB")) is None
    assert gar.verify_state(None) is None and gar.verify_state("") is None
    now = datetime.now(timezone.utc)
    expired = pyjwt.encode({"purpose": "ga_oauth", "brand": BRAND, "uid": USER_ID, "iat": now - timedelta(hours=1),
                            "exp": now - timedelta(minutes=1)}, get_jwt_secret(), algorithm=JWT_ALGORITHM)
    assert gar.verify_state(expired) is None
    with_sub = pyjwt.encode({"purpose": "ga_oauth", "brand": BRAND, "uid": USER_ID, "sub": USER_ID, "iat": now,
                             "exp": now + timedelta(minutes=5)}, get_jwt_secret(), algorithm=JWT_ALGORITHM)
    assert gar.verify_state(with_sub) is None
    wrong_key = pyjwt.encode({"purpose": "ga_oauth", "brand": BRAND, "uid": USER_ID, "iat": now,
                              "exp": now + timedelta(minutes=5)},
                             "another-signing-key-not-real-0123456789abcdef", algorithm=JWT_ALGORITHM)
    assert gar.verify_state(wrong_key) is None


def test_serialized_status_never_contains_the_refresh_token():
    for r in (connected_row(), connected_row(status="reconnect_required", last_error="expired"),
              connected_row(refresh_token=FAKE_REFRESH, config={}), None):
        out = gar.serialize_status(r, BRAND_ROW, True, True, "https://reach.example.com" + gar.CALLBACK_PATH)
        blob = json.dumps(out)
        assert FAKE_REFRESH not in blob
        assert not [k for k in out if "token" in k.lower()]
        assert set(out) >= {"configured", "connected", "status", "account_email", "property_id", "property_name",
                            "highlight_source", "show_on_dashboard", "last_error", "can_manage"}


def test_status_values_and_highlight_default():
    assert gar.serialize_status(None, BRAND_ROW, False, True)["status"] == "not_connected"
    s = gar.serialize_status(connected_row(), BRAND_ROW, False, True)
    assert s["status"] == "connected" and s["connected"] is True and s["property_id"] == PROPERTY
    assert s["highlight_source"] == "example-outreach"  # brands.sender.utm_source
    assert "redirect_uri" not in s
    assert gar.serialize_status(connected_row(status="reconnect_required"), BRAND_ROW, True, True)["status"] \
        == "reconnect_required"
    assert gar.serialize_status(connected_row(refresh_token=None), BRAND_ROW, True, True)["connected"] is False
    explicit = connected_row(config={"property_id": PROPERTY, "highlight_source": "newsletter"})
    assert gar.serialize_status(explicit, BRAND_ROW, True, True)["highlight_source"] == "newsletter"
    hidden = connected_row(config={"property_id": PROPERTY, "show_on_dashboard": False})
    assert gar.serialize_status(hidden, BRAND_ROW, True, True)["show_on_dashboard"] is False


def test_default_highlight_source_follows_the_sender():
    assert gar.default_highlight_source(dict(BRAND_ROW, sender={})) == "example-brand"  # brand slug
    default_brand = dict(BRAND_ROW, id=tenancy.DEFAULT_BRAND_ID, sender={})
    assert gar.default_highlight_source(default_brand) == "utilizereach-outreach"
    assert gar.default_highlight_source(None) == ""


# ---------------------------------------------------------------------------
# router: endpoints (called directly; DB and Google faked)
# ---------------------------------------------------------------------------

def test_status_endpoint_masks_token_and_reports_permissions(db):
    db.rows[BRAND] = connected_row()
    admin = run(gar.ga_status(make_request(), current_user=ADMIN))
    viewer = run(gar.ga_status(make_request(), current_user=VIEWER))
    for out in (admin, viewer):
        assert FAKE_REFRESH not in json.dumps(out)
    assert admin["can_manage"] is True and admin["redirect_uri"] == "https://reach.example.com" + gar.CALLBACK_PATH
    assert viewer["can_manage"] is False and "redirect_uri" not in viewer


def test_auth_url_carries_a_ga_state(db):
    out = run(gar.ga_auth_start(make_request(), current_user=ADMIN))
    from urllib.parse import parse_qs, urlparse
    q = parse_qs(urlparse(out["auth_url"]).query)
    assert q["redirect_uri"] == ["https://reach.example.com/api/integrations/google-analytics/callback"]
    assert gar.verify_state(q["state"][0])["brand"] == BRAND
    assert "include_granted_scopes" not in q


def test_realtime_endpoint_fetches_then_serves_cache(db, monkeypatch):
    db.rows[BRAND] = connected_row()
    session = use_session(monkeypatch, realtime_handler)
    first = run(gar.ga_realtime(current_user=VIEWER))
    assert first["connected"] is True and first["active_users"] == 7 and first["cached"] is False
    assert "error" not in first and len(first["per_minute"]) == 30
    second = run(gar.ga_realtime(current_user=VIEWER))
    assert second["cached"] is True and len(session.calls) == 5


def test_realtime_endpoint_gates(db, monkeypatch):
    session = use_session(monkeypatch, lambda m, u, b: AssertionError("Google must not be called"))
    out = run(gar.ga_realtime(current_user=VIEWER))
    assert out["connected"] is False and out["error"]["code"] == "not_connected"
    assert out["per_minute"] == [{"minutes_ago": m, "users": 0} for m in range(30)]

    db.rows[BRAND] = connected_row(config={})
    assert run(gar.ga_realtime(current_user=VIEWER))["error"]["code"] == "invalid_property"

    db.rows[BRAND] = connected_row(status="reconnect_required")
    out = run(gar.ga_realtime(current_user=VIEWER))
    assert out["error"]["code"] == "reconnect_required" and out["connected"] is False

    monkeypatch.delenv("GOOGLE_CLIENT_SECRET")
    db.rows[BRAND] = connected_row()
    assert run(gar.ga_realtime(current_user=VIEWER))["error"]["code"] == "not_configured"
    assert session.calls == []


def test_realtime_invalid_grant_marks_row_reconnect_required(db, monkeypatch):
    from google.auth.exceptions import RefreshError

    db.rows[BRAND] = connected_row()
    session = use_session(monkeypatch, lambda m, u, b: RefreshError("invalid_grant: Token has been expired"))
    out = run(gar.ga_realtime(current_user=VIEWER))
    assert out["error"]["code"] == "reconnect_required" and out["connected"] is False
    assert db.rows[BRAND]["status"] == "reconnect_required"
    assert FAKE_REFRESH not in (db.rows[BRAND]["last_error"] or "") and FAKE_REFRESH not in json.dumps(out)
    calls = len(session.calls)
    run(gar.ga_realtime(current_user=VIEWER))  # gated now: Google is not asked again
    assert len(session.calls) == calls


def test_realtime_quota_serves_last_good_value(db, monkeypatch):
    clock = Clock()
    monkeypatch.setattr(ga, "CACHE", ga.TTLCache(clock=clock))
    db.rows[BRAND] = connected_row()
    state = {"quota": False}

    def handler(method, url, body):
        if state["quota"]:
            return google_error(429, "RESOURCE_EXHAUSTED", "Exhausted")
        return realtime_handler(method, url, body)

    use_session(monkeypatch, handler)
    run(gar.ga_realtime(current_user=VIEWER))
    clock.t += ga.REALTIME_TTL + 1
    state["quota"] = True
    out = run(gar.ga_realtime(current_user=VIEWER))
    assert out["cached"] is True and out["active_users"] == 7 and out["error"]["code"] == "quota_exceeded"
    assert db.rows[BRAND]["last_error"] is None  # transient errors are not persisted


def test_api_disabled_is_recorded_then_cleared(db, monkeypatch):
    clock = Clock()
    monkeypatch.setattr(ga, "CACHE", ga.TTLCache(clock=clock))
    db.rows[BRAND] = connected_row()
    state = {"disabled": True}

    def handler(method, url, body):
        if state["disabled"]:
            return google_error(403, "PERMISSION_DENIED", "API has not been used in project 1 before",
                                "SERVICE_DISABLED", "analyticsdata.googleapis.com")
        return realtime_handler(method, url, body)

    use_session(monkeypatch, handler)
    out = run(gar.ga_realtime(current_user=VIEWER))
    assert out["error"]["code"] == "api_disabled" and out["connected"] is True
    assert "Google Analytics Data API" in db.rows[BRAND]["last_error"]
    assert db.rows[BRAND]["status"] == "connected"
    state["disabled"] = False
    clock.t += ga.NEGATIVE_TTL + 1
    out = run(gar.ga_realtime(current_user=VIEWER))
    assert out["error"]["code"] == "api_disabled"  # remembered: only an admin can fix it
    clock.t += ga.LASTING_ERROR_TTL
    out = run(gar.ga_realtime(current_user=VIEWER))
    assert "error" not in out and db.rows[BRAND]["last_error"] is None


def test_summary_endpoint_uses_brand_source_and_validates_days(db, monkeypatch):
    db.rows[BRAND] = connected_row()
    session = use_session(monkeypatch, summary_handler)
    out = run(gar.ga_summary(days=28, current_user=VIEWER))
    assert out["connected"] is True and out["days"] == 28 and out["highlight_source"] == "example-outreach"
    assert out["totals"]["sessions"] == 120 and out["email"]["totals"]["sessions"] == 30
    values = {r["dimensionFilter"]["filter"]["stringFilter"]["value"]
              for c in session.calls for r in c[2]["requests"] if "dimensionFilter" in r}
    assert values == {"example-outreach"}
    with pytest.raises(HTTPException) as exc:
        run(gar.ga_summary(days=3, current_user=VIEWER))
    assert exc.value.status_code == 400

    out = run(gar.ga_summary(days=7, current_user=VIEWER))
    assert out["cached"] is False  # different period -> different cache key
    out = run(gar.ga_summary(days=7, current_user=VIEWER))
    assert out["cached"] is True


def test_properties_endpoint_and_errors(db, monkeypatch):
    with pytest.raises(HTTPException) as exc:
        run(gar.ga_properties(current_user=ADMIN))
    assert exc.value.status_code == 400  # not connected

    db.rows[BRAND] = connected_row()
    use_session(monkeypatch, lambda m, u, b: FakeResponse(200, {"accountSummaries": [
        {"displayName": "Example Account", "propertySummaries": [
            {"property": "properties/123456789", "displayName": "Example site"}]}]}))
    out = run(gar.ga_properties(current_user=ADMIN))
    assert out["properties"] == [{"property_id": PROPERTY, "display_name": "Example site",
                                  "account_name": "Example Account"}]

    ga.CACHE.clear()
    use_session(monkeypatch, lambda m, u, b: google_error(
        403, "PERMISSION_DENIED", "Google Analytics Admin API has not been used in project 1 before",
        "SERVICE_DISABLED", "analyticsadmin.googleapis.com"))
    with pytest.raises(HTTPException) as exc:
        run(gar.ga_properties(current_user=ADMIN))
    assert exc.value.status_code == 400 and "Google Analytics Admin API" in exc.value.detail


def test_settings_endpoint_validates_and_saves(db, monkeypatch):
    db.rows[BRAND] = connected_row(config={})
    use_session(monkeypatch, lambda m, u, b: FakeResponse(200, {"accountSummaries": [
        {"displayName": "Example Account", "propertySummaries": [
            {"property": "properties/123456789", "displayName": "Example site"}]}]}))
    req = make_request()

    for bad in ({"property_id": "abc"}, {"property_id": "999"}, {"highlight_source": "x" * 101},
                {"highlight_source": "bad\nvalue"}):
        with pytest.raises(HTTPException) as exc:
            run(gar.ga_update_settings(gar.GASettingsUpdate(**bad), req, current_user=ADMIN))
        assert exc.value.status_code == 400

    out = run(gar.ga_update_settings(gar.GASettingsUpdate(property_id=PROPERTY, highlight_source="  newsletter "),
                                     req, current_user=ADMIN))
    assert out["property_id"] == PROPERTY and out["property_name"] == "Example site"
    assert out["highlight_source"] == "newsletter" and FAKE_REFRESH not in json.dumps(out)

    out = run(gar.ga_update_settings(gar.GASettingsUpdate(highlight_source="", show_on_dashboard=False),
                                     req, current_user=ADMIN))
    assert out["highlight_source"] == "example-outreach" and out["show_on_dashboard"] is False
    assert out["property_id"] == PROPERTY  # untouched


def test_settings_requires_a_connection(db):
    with pytest.raises(HTTPException) as exc:
        run(gar.ga_update_settings(gar.GASettingsUpdate(show_on_dashboard=True), make_request(),
                                   current_user=ADMIN))
    assert exc.value.status_code == 400


def _callback(state: Optional[str], code: Optional[str] = "test-code", error: Optional[str] = None):
    return run(gar.ga_auth_callback(make_request(gar.CALLBACK_PATH), code=code, error=error, state=state))


def _ticket_from(resp) -> str:
    from urllib.parse import parse_qs, urlparse

    loc = urlparse(location(resp))
    assert parse_qs(loc.query) == {"ga": ["confirm"]}
    return parse_qs(loc.fragment)["ga_ticket"][0]


def _signed_in(monkeypatch):
    monkeypatch.setattr(gar, "_state_user_may_manage", lambda claims: True)
    monkeypatch.setattr(ga, "exchange_code", lambda redirect_uri, code: {
        "refresh_token": FAKE_REFRESH, "scopes": list(ga.SCOPES), "email": "you@example.com"})


def test_callback_stores_nothing_and_hands_back_an_encrypted_ticket(db, monkeypatch):
    _signed_in(monkeypatch)
    tenancy.set_current_brand(None)  # public endpoint: no brand until the state is verified

    resp = _callback(gar.mint_state(BRAND, USER_ID))
    assert location(resp).startswith("https://app.example.com/settings/integrations?ga=confirm#ga_ticket=")
    ticket = _ticket_from(resp)
    assert FAKE_REFRESH not in location(resp) and "you@example.com" not in location(resp)  # encrypted
    assert not db.rows and not [st for st in db.statements if "brand_integrations" in st[0]]
    data = gar.open_connect_ticket(ticket)
    assert data["brand"] == BRAND and data["uid"] == USER_ID and data["rt"] == FAKE_REFRESH


def test_connect_saves_the_ticket_and_auto_selects_single_property(db, monkeypatch):
    _signed_in(monkeypatch)
    use_session(monkeypatch, lambda m, u, b: FakeResponse(200, {"accountSummaries": [
        {"displayName": "Example Account", "propertySummaries": [
            {"property": "properties/123456789", "displayName": "Example site"}]}]}))
    ticket = _ticket_from(_callback(gar.mint_state(BRAND, USER_ID)))

    out = run(gar.ga_connect(gar.GAConnectBody(ticket=ticket), make_request(), current_user=ADMIN))
    assert out["connected"] is True and out["property_id"] == PROPERTY and out["account_email"] == "you@example.com"
    assert FAKE_REFRESH not in json.dumps(out)
    r = db.rows[BRAND]
    assert r["refresh_token"] == FAKE_REFRESH and r["connected_by"] == USER_ID
    assert r["config"]["property_id"] == PROPERTY and r["config"]["property_name"] == "Example site"
    writes = [st for st in db.statements if "brand_integrations" in st[0]]
    assert writes and all(brand == BRAND for _, _, brand, _ in writes)


def test_connect_with_another_account_asks_for_the_property_again(db, monkeypatch):
    db.rows[BRAND] = connected_row(account_email="old@example.com",
                                   config={"property_id": PROPERTY, "highlight_source": "newsletter",
                                           "show_on_dashboard": False})
    use_session(monkeypatch, lambda m, u, b: FakeResponse(200, {}))  # the new account sees nothing
    ticket = gar.mint_connect_ticket(BRAND, USER_ID, FAKE_REFRESH, "you@example.com")
    out = run(gar.ga_connect(gar.GAConnectBody(ticket=ticket), make_request(), current_user=ADMIN))
    assert out["property_id"] is None and out["highlight_source"] == "newsletter"
    assert out["show_on_dashboard"] is False and out["account_email"] == "you@example.com"


def test_connect_ticket_is_bound_to_the_user_brand_and_time(db, monkeypatch):
    """A consent link forwarded to someone else cannot connect THEIR Google
    account: only the admin who started it, in that brand, can finish it."""
    from cryptography.fernet import Fernet

    _signed_in(monkeypatch)
    ticket = _ticket_from(_callback(gar.mint_state(BRAND, USER_ID)))
    other_admin = dict(ADMIN, id="00000000-0000-0000-0000-00000000c002")

    def refused(tk: str, user: dict = ADMIN) -> None:
        with pytest.raises(HTTPException) as exc:
            run(gar.ga_connect(gar.GAConnectBody(ticket=tk), make_request(), current_user=user))
        assert exc.value.status_code == 400 and FAKE_REFRESH not in str(exc.value.detail)

    refused(ticket, other_admin)                                    # another admin of the same brand
    tenancy.set_current_brand(OTHER_BRAND)
    refused(ticket)                                                 # the same user, another brand
    tenancy.set_current_brand(BRAND)
    refused(ticket[:-6] + ("AAAAAA" if not ticket.endswith("AAAAAA") else "BBBBBB"))  # tampered
    refused("not-a-ticket")
    refused(gar.mint_state(BRAND, USER_ID))                         # a signed state is not a ticket
    refused("x" * 5000)
    old = gar._ticket_cipher().encrypt_at_time(json.dumps({
        "purpose": "ga_connect", "brand": BRAND, "uid": USER_ID, "rt": FAKE_REFRESH}).encode(),
        int(time.time()) - 3600)
    refused(old.decode())                                           # older than 10 minutes
    foreign = Fernet(Fernet.generate_key()).encrypt(json.dumps({
        "purpose": "ga_connect", "brand": BRAND, "uid": USER_ID, "rt": FAKE_REFRESH}).encode())
    refused(foreign.decode())                                       # not encrypted with our key
    assert not db.rows

    use_session(monkeypatch, lambda m, u, b: FakeResponse(200, {}))
    run(gar.ga_connect(gar.GAConnectBody(ticket=ticket), make_request(), current_user=ADMIN))
    assert db.rows[BRAND]["refresh_token"] == FAKE_REFRESH         # the right user, in time: saved


def test_callback_uses_signed_return_base(db, monkeypatch):
    _signed_in(monkeypatch)
    resp = _callback(gar.mint_state(BRAND, USER_ID, "https://brand.example.com"))
    assert location(resp).startswith("https://brand.example.com/settings/integrations?ga=confirm#ga_ticket=")


@pytest.mark.parametrize("case,expected", [
    ("gmail_state", "invalid_state"),
    ("no_state", "invalid_state"),
    ("no_code", "no_code"),
    ("access_denied", "access_denied"),
    ("weird_error", "oauth_error"),
    ("not_allowed", "not_allowed"),
    ("scope_missing", "scope_missing"),
    ("no_refresh_token", "no_refresh_token"),
    ("exchange_failed", "exchange_failed"),
    ("crash", "callback_failed"),
])
def test_callback_failures_redirect_with_a_code_and_write_nothing(db, monkeypatch, case, expected):
    monkeypatch.setattr(gar, "_state_user_may_manage", lambda claims: case != "not_allowed")
    scopes = ["openid"] if case == "scope_missing" else list(ga.SCOPES)
    token = None if case == "no_refresh_token" else FAKE_REFRESH

    def exchange(redirect_uri, code):
        if case == "exchange_failed":
            raise GAError("upstream_error")
        if case == "crash":
            raise RuntimeError(f"unexpected {FAKE_REFRESH}")
        return {"refresh_token": token, "scopes": scopes, "email": "you@example.com"}

    monkeypatch.setattr(ga, "exchange_code", exchange)
    state = gar.mint_state(BRAND, USER_ID)
    kwargs: Dict[str, Any] = {"state": state}
    if case == "gmail_state":
        kwargs["state"] = email_accounts._mint_oauth_state(BRAND, USER_ID)
    elif case == "no_state":
        kwargs["state"] = None
    elif case == "no_code":
        kwargs["code"] = None
    elif case == "access_denied":
        kwargs["error"] = "access_denied"
    elif case == "weird_error":
        kwargs["error"] = "<script>alert(1)</script>"
    resp = _callback(**kwargs)
    assert location(resp) == f"https://app.example.com/settings/integrations?ga_error={expected}"
    assert not db.rows
    assert not [s for s in db.statements if s[0].startswith(("INSERT", "UPDATE", "DELETE"))]


def test_callback_permission_recheck_uses_settings_manage(db, monkeypatch):
    calls = {}

    def fake_resolve(user, brand, host):
        calls["brand"] = brand
        return {"brand": {"id": BRAND}, "role": calls.get("role", "manager"), "brands": []}

    monkeypatch.setattr(gar, "resolve_user_brand", fake_resolve)
    claims = {"uid": USER_ID, "brand": BRAND}
    assert gar._state_user_may_manage(claims) is False      # manager lacks settings.manage
    calls["role"] = "admin"
    assert gar._state_user_may_manage(claims) is True
    db.users[USER_ID]["is_active"] = False
    assert gar._state_user_may_manage(claims) is False      # deactivated since the flow started
    db.users[USER_ID].update(is_active=True)
    monkeypatch.setattr(gar, "resolve_user_brand",
                        lambda u, b, h: {"brand": {"id": OTHER_BRAND}, "role": "admin", "brands": []})
    assert gar._state_user_may_manage(claims) is False      # no longer a member of that brand


def test_disconnect_revokes_unless_the_google_account_is_shared(db, monkeypatch):
    revoked = []
    monkeypatch.setattr(ga, "revoke_token", lambda token: revoked.append(token) or True)
    monkeypatch.setattr("integrations.brand_mail.GMAIL_TOKENS_FILE", Path("/nonexistent/.gmail_tokens"))

    db.rows[BRAND] = connected_row()
    db.mailboxes.add("you@example.com")  # same Google account sends mail: never revoke its grant
    assert run(gar.ga_disconnect(current_user=ADMIN)) == {"ok": True}
    assert revoked == [] and BRAND not in db.rows

    db.mailboxes.clear()
    db.rows[BRAND] = connected_row()
    db.rows[OTHER_BRAND] = connected_row(brand_id=OTHER_BRAND)  # another brand's GA uses it
    run(gar.ga_disconnect(current_user=ADMIN))
    assert revoked == [] and BRAND not in db.rows and OTHER_BRAND in db.rows

    db.rows.pop(OTHER_BRAND)
    db.rows[BRAND] = connected_row()
    run(gar.ga_disconnect(current_user=ADMIN))
    assert revoked == [FAKE_REFRESH] and BRAND not in db.rows

    assert run(gar.ga_disconnect(current_user=ADMIN)) == {"ok": True}  # nothing connected: still ok


def test_routes_and_permissions_are_wired():
    from fastapi.routing import APIRoute

    public = {(r.path, tuple(sorted(r.methods))) for r in gar.public_router.routes if isinstance(r, APIRoute)}
    assert public == {(gar.CALLBACK_PATH, ("GET",))}
    routes = {(r.path, m) for r in gar.router.routes if isinstance(r, APIRoute) for m in r.methods}
    paths = {p for p, _ in routes}
    assert gar.CALLBACK_PATH not in paths
    assert {gar.PREFIX + p for p in ("/status", "/auth", "/properties", "/settings", "/realtime",
                                     "/summary")} <= paths
    assert gar.PREFIX in paths and (gar.PREFIX + "/connect", "POST") in routes


def test_hidden_from_dashboard_means_hidden_from_viewers(db, monkeypatch):
    """"Show on dashboard" off is enforced by the API, not only the UI."""
    db.rows[BRAND] = connected_row(config={"property_id": PROPERTY, "show_on_dashboard": False})
    session = use_session(monkeypatch, realtime_handler)
    out = run(gar.ga_realtime(current_user=VIEWER))
    assert out["error"]["code"] == "not_connected" and "switched off" in out["error"]["message"]
    assert out["active_users"] == 0 and out["top_pages"] == [] and session.calls == []
    out = run(gar.ga_summary(days=7, current_user=VIEWER))
    assert out["error"]["code"] == "not_connected" and out["sources"] == [] and session.calls == []

    out = run(gar.ga_realtime(current_user=ADMIN))  # admins can still check the data
    assert "error" not in out and out["active_users"] == 7
