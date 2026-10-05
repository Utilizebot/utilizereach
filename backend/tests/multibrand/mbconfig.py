"""
Configuration, deterministic fixture ids and leak markers for the cross-brand
isolation suite. See README.md in this directory.

Everything is driven by environment variables so the same suite runs against
any local backend + a disposable/staging database:

    MB_API            backend base URL                (http://127.0.0.1:18000)
    MB_OWNER_DSN      schema-owner DSN (fixtures)      (postgresql://marketing:marketing@127.0.0.1:55432/marketing_ai)
    MB_APP_DSN        least-privilege app_rw DSN (RLS) (postgresql://app_rw:apprw_local@127.0.0.1:55432/marketing_ai)
    MB_TIMEOUT        per-request timeout, seconds     (60)
    MB_STRICT         1 = wrong-but-harmless status codes (e.g. 200 on a
                      cross-brand delete that changed nothing) FAIL instead of WARN
    MB_KEEP_FIXTURES  1 = keep the brand-1 "victim" rows after the run
    MB_REPORT         JSON report path (<this dir>/reports/last_report.json)
    MB_JWT_SECRET     optional: the server's JWT secret, enables forged-token tests
    MB_TEST_PASSWORD  password for the four test users
    MB_BRAND_CACHE_WAIT  seconds to wait for the API's brand cache to see a
                      newly created brand (45)
    MB_BRAND1_SLUG    fallback slug of brand 1 (default); normally read from the DB
"""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND_DIR = HERE.parents[1]          # .../backend  (== /app in the container)
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

API = os.getenv("MB_API", "http://127.0.0.1:18000").rstrip("/")
OWNER_DSN = os.getenv("MB_OWNER_DSN", "postgresql://marketing:marketing@127.0.0.1:55432/marketing_ai")
APP_DSN = os.getenv("MB_APP_DSN", "postgresql://app_rw:apprw_local@127.0.0.1:55432/marketing_ai")
TIMEOUT = float(os.getenv("MB_TIMEOUT", "60"))
STRICT = os.getenv("MB_STRICT", "") == "1"
KEEP_FIXTURES = os.getenv("MB_KEEP_FIXTURES", "") == "1"
REPORT_PATH = Path(os.getenv("MB_REPORT", str(HERE / "reports" / "last_report.json")))
def _server_jwt_secret() -> str:
    """MB_JWT_SECRET, else the secret a backend sharing this mount would use
    (backend/.env JWT_SECRET, then the persisted config/.jwt_secret). Only used
    to mint test tokens; if it does not match the server those tests SKIP."""
    v = os.getenv("MB_JWT_SECRET", "").strip()
    if v:
        return v
    try:
        from dotenv import dotenv_values
        v = (dotenv_values(BACKEND_DIR / ".env").get("JWT_SECRET") or "").strip()
        if v:
            return v
    except Exception:
        pass
    for p in (BACKEND_DIR / "config" / ".jwt_secret", BACKEND_DIR / ".jwt_secret"):
        try:
            if p.exists():
                return p.read_text().strip()
        except OSError:
            pass
    return ""


JWT_SECRET = _server_jwt_secret()
PASSWORD = os.getenv("MB_TEST_PASSWORD", "IsoTest!2026-mb")
BRAND_CACHE_WAIT = float(os.getenv("MB_BRAND_CACHE_WAIT", "45"))

BRAND1_ID = "00000000-0000-0000-0000-0000000000a1"
# Brand 1 = the default brand (fixed id, created by database/multibrand.sql).
# Its slug is read from the database at fixture time (mbfixtures.resolve_brand1_slug),
# so the suite works on a fresh install ("default") and on renamed installs.
# MB_BRAND1_SLUG only seeds the value used before the database is reachable.
BRAND1_SLUG = os.getenv("MB_BRAND1_SLUG", "default")
ACME_SLUG = "acme"
ACME_NAME = "Acme Isolation Test"
ACME_HOST = "acme-iso.test"          # brand-dedicated hostname for Host-pinning tests

# ---------------------------------------------------------------------------
# Deterministic ids: every fixture row has a fixed primary key so seeding is
# idempotent (re-running restores the canonical state, even after a leak
# mutated a row).
# ---------------------------------------------------------------------------
_NS = uuid.UUID("5b0c7a52-9d1e-4f43-a3f0-1505a7e0b001")


def fid(name: str) -> str:
    return str(uuid.uuid5(_NS, name))


ACME_BRAND_ID_DEFAULT = fid("brand.acme")   # used only when no brand 'acme' exists yet

# ---------------------------------------------------------------------------
# Markers. A response seen by brand X must never contain brand Y's markers.
# Inputs we send (ids in the path, query values) are scrubbed from a response
# before scanning, so an error message echoing our own input is not a "leak".
# ---------------------------------------------------------------------------
ACME_DOMAIN = "acme-isolation.test"
ACME_TEXT = "ACME_ISO_MARKER"
XW_DOMAIN = "xw-isolation.test"
XW_TEXT = "XW_ISO_MARKER"
NEUTRAL_DOMAIN = "mb-isolation.test"                  # plat_admin (belongs to no brand)
SHARED_EMAIL = "shared@mb-iso-shared.example.com"     # excluded in BOTH brands (collision test)
PROBE_DOMAIN = "mb-iso-probe.example.com"             # rows an API probe might create
PROBE_TEXT = "MB_ISO_PROBE"
PROBE_BRAND_SLUG = "mb-iso-probe"                     # brand a failed "create brand" probe would create

# Fake secrets planted (only for the duration of the secrets check, then put
# back) so "no OAuth token / AI key in the response" is never vacuous.
FAKE_TOKENS = {
    "acme": {"refresh_token": "mbiso-FAKE-refresh-acme-5b0c7a52e1", "access_token": "mbiso-FAKE-access-acme-9d1e4f43"},
    "xw": {"refresh_token": "mbiso-FAKE-refresh-xw-a3f01505a7", "access_token": "mbiso-FAKE-access-xw-e0b001c3"},
}
FAKE_AI_KEY = "sk-mbiso-fake-ai-key-acme-7Qz3Xw9Lp2Rk"

# Lead "names" used as search terms. They are deliberately NOT markers, so
# scrubbing the query value cannot hide a real leak.
ACME_SEARCH = "Acmeleadname"
XW_SEARCH = "Xwvictimname"

# Segment keys
ACME_SEG = "acme_iso_seg"            # acme only
XW_SEG_ONLY = "xw_iso_only_seg"      # brand 1 only
SHARED_SEG = "xw_iso_shared_seg"     # exists in BOTH brands (per-brand unique key)

USERS = {
    "acme_admin": {"email": f"acme_admin@{ACME_DOMAIN}", "full_name": "Acme Iso Admin",
                   "memberships": [("acme", "admin")], "platform": False},
    "xw_admin": {"email": f"xw_admin@{XW_DOMAIN}", "full_name": "Xw Iso Admin",
                 "memberships": [("brand1", "admin")], "platform": False},
    "xw_viewer": {"email": f"xw_viewer@{XW_DOMAIN}", "full_name": "Xw Iso Viewer",
                  "memberships": [("brand1", "viewer")], "platform": False},
    "plat_admin": {"email": f"plat_admin@{NEUTRAL_DOMAIN}", "full_name": "Platform Iso Admin",
                   "memberships": [], "platform": True},
    # one acme user per remaining role (secrets check: every role's view of
    # mailbox tokens and the AI key)
    "acme_manager": {"email": f"acme_manager@{ACME_DOMAIN}", "full_name": "Acme Iso Manager",
                     "memberships": [("acme", "manager")], "platform": False},
    "acme_member": {"email": f"acme_member@{ACME_DOMAIN}", "full_name": "Acme Iso Member",
                    "memberships": [("acme", "member")], "platform": False},
    "acme_viewer": {"email": f"acme_viewer@{ACME_DOMAIN}", "full_name": "Acme Iso Viewer",
                    "memberships": [("acme", "viewer")], "platform": False},
}
# A brand-1 member with NO password (legacy profile). Used to prove another
# brand's admin cannot claim it by "adding" it with a password.
LEGACY_USER = {"email": f"xw_legacy@{XW_DOMAIN}", "full_name": "Xw Iso Legacy",
               "memberships": [("brand1", "viewer")]}


def ids_for(side: str) -> dict:
    """Fixed object ids for one side: 'acme' (the new brand) or 'xw' (brand-1 victims)."""
    p = side
    d = {
        "campaign": fid(f"{p}.campaign"),
        "email_account": fid(f"{p}.email_account"),
        "job": fid(f"{p}.job"),
        "lead": fid(f"{p}.lead1"),
        "lead2": fid(f"{p}.lead2"),
        "lead3": fid(f"{p}.lead3"),
        "sent_email": fid(f"{p}.sent1"),
        "reply": fid(f"{p}.reply1"),
        "exclusion": fid(f"{p}.excl1"),
        "exclusion_shared": fid(f"{p}.excl_shared"),
        "segment_id": fid(f"{p}.segment"),
        "segment_shared_id": fid(f"{p}.segment_shared"),
        "api_key": fid(f"{p}.apikey1"),
        "stakeholder": fid(f"{p}.stake1"),
        "approval": fid(f"{p}.approval1"),
        "run": fid(f"{p}.run1"),
        "post": fid(f"{p}.post1"),
        "platform": "linkedin",
    }
    if side == "acme":
        d.update({
            "segment_key": ACME_SEG,
            "lead_email": f"lead1@{ACME_DOMAIN}",
            "lead2_email": f"lead2@{ACME_DOMAIN}",
            "excluded_email": f"excluded1@{ACME_DOMAIN}",
            "sent_recipient": f"sent1@{ACME_DOMAIN}",
            "account_email": f"acme-sender@{ACME_DOMAIN}",
            "search": ACME_SEARCH,
            "batch": "acme_iso_batch",
            "click": fid("acme.click1"),
            "bounce": fid("acme.bounce1"),
            "unsub": fid("acme.unsub1"),
            "ai_settings": fid("acme.ai_settings"),
            "sched_settings": fid("acme.sched_settings"),
            "social": fid("acme.social_linkedin"),
            "audit": fid("acme.audit1"),
            "form_row": fid("acme.form_session_row"),
            "form_session": fid("acme.form_session"),
            "form_response": fid("acme.form_response1"),
            "tracking_event": fid("acme.tracking_event1"),
            "scrape_log": fid("acme.scrape_log1"),
        })
    else:
        d.update({
            "segment_key": XW_SEG_ONLY,
            "lead_email": f"victim1@{XW_DOMAIN}",
            "lead2_email": f"victim2@{XW_DOMAIN}",
            "excluded_email": f"victim-excl@{XW_DOMAIN}",
            "sent_recipient": f"victim-sent@{XW_DOMAIN}",
            "account_email": f"xw-victim-sender@{XW_DOMAIN}",
            "search": XW_SEARCH,
            "batch": "xw_iso_batch_none",
        })
    return d


ACME_IDS = ids_for("acme")
XW_IDS = ids_for("xw")

# Object ids that are themselves leak markers (ids are unguessable, so seeing
# one in the other brand's response means its row leaked).
_MARKER_ID_KEYS = ("campaign", "email_account", "job", "lead", "lead2", "lead3", "sent_email",
                   "reply", "exclusion", "api_key", "stakeholder", "approval", "run", "post")


def base_markers(side: str) -> list:
    ids = ACME_IDS if side == "acme" else XW_IDS
    if side == "acme":
        out = [ACME_DOMAIN, ACME_TEXT]
    else:
        out = [XW_DOMAIN, XW_TEXT]
    out += [ids[k] for k in _MARKER_ID_KEYS]
    return out


# Path / query parameter name -> keys of ids_for() to substitute (first wins
# for the "own" call; every candidate is tried for the "foreign" calls).
PARAM_MAP = {
    "cid": ["campaign"], "campaign_id": ["campaign"],
    "lead_id": ["sent_email", "lead"],          # /api/leads/{lead_id} reads sent_emails
    "email_id": ["sent_email"], "sent_email_id": ["sent_email"],
    "reply_id": ["reply"],
    "account_id": ["email_account"], "email_account_id": ["email_account"],
    "exclusion_id": ["exclusion"],
    "email": ["excluded_email", "lead_email"],
    "key_id": ["api_key"],
    "approval_id": ["approval"],
    "stakeholder_id": ["stakeholder"],
    "run_id": ["run"],
    "job_id": ["job"],
    "key": ["segment_key"], "segment": ["segment_key"],
    "platform": ["platform"],
    "post_id": ["post"],
    "user_id": ["user"],
    "brand_id": ["brand"],
    "batch_id": ["batch"],
    "session_id": ["form_session"],
    "search": ["search"], "q": ["search"],
}
# Query parameters worth probing with the other brand's values.
QUERY_PROBE_PARAMS = {
    "campaign_id", "lead_id", "account_id", "email_account_id", "sent_email_id", "job_id",
    "segment", "search", "q", "email", "stakeholder_id", "platform", "key", "batch_id",
}
