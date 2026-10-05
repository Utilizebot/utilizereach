"""
Fixtures for the cross-brand isolation suite (owner DSN, tenancy bypass on).

    seed()            idempotent: brand 'acme' + the test users + distinctive
                      marker rows in every major tenant table for acme, plus a
                      few sacrificial brand-1 "victim" rows the attacks target
                      (so a real leak never damages genuine brand-1 data).
                      Scrubs leftovers of earlier runs first (all acme rows,
                      probe rows/accounts/brand), so every run starts from the
                      same state.
    cleanup(full)     removes the brand-1 victims, anything an API probe may
                      have created and every acme tenant row (brand acme and
                      the users stay); full=True also removes brand acme and
                      the test users.
    discover()        ids + real brand-1 markers (persona addresses, campaign
                      names, recent recipients) read from the database.

CLI (from backend/ or /app):
    python tests/multibrand/mbfixtures.py seed [--dry-run]
    python tests/multibrand/mbfixtures.py cleanup [--all]
    python tests/multibrand/mbfixtures.py show
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence

import mbconfig as cfg
from mbdb import adapt, owner_conn, q, triggers_off, triggers_on

A = cfg.ACME_IDS
X = cfg.XW_IDS
B1 = cfg.BRAND1_ID


def _hash(password: str) -> str:
    try:
        from api.security import hash_password  # the app's own bcrypt helper
        return hash_password(password)
    except Exception:
        import bcrypt
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _upsert(cur, table: str, row: Dict[str, Any], pk: str = "id",
            natural: Optional[Sequence[str]] = None) -> None:
    """INSERT .. ON CONFLICT (pk) DO UPDATE, after removing any OTHER row that
    holds the same natural unique key (e.g. an acme settings row the app
    auto-created with a different id)."""
    if natural:
        where = " AND ".join(f"{c} = %s" for c in natural)
        cur.execute(f"DELETE FROM {table} WHERE {where} AND {pk}::text <> %s",
                    [row[c] for c in natural] + [str(row[pk])])
    cols = list(row)
    sets = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c != pk)
    cur.execute(
        f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))}) "
        f"ON CONFLICT ({pk}) DO UPDATE SET {sets}",
        [adapt(row[c]) for c in cols],
    )


# ---------------------------------------------------------------------------
# Brand + users
# ---------------------------------------------------------------------------

def _ensure_acme(cur) -> str:
    row = cur.execute("SELECT id FROM brands WHERE slug = %s", [cfg.ACME_SLUG]).fetchone()
    branding = {"company": {"name": f"{cfg.ACME_NAME} {cfg.ACME_TEXT}", "website": f"https://{cfg.ACME_DOMAIN}"},
                "dashboard": {"title": f"{cfg.ACME_TEXT} dashboard"}}
    sender = {"sending_enabled": False, "cta_url": f"https://{cfg.ACME_DOMAIN}"}
    if row:
        bid = str(row["id"])
        cur.execute(
            "UPDATE brands SET is_active = TRUE, display_name = %s, hostnames = %s, website_domain = %s, "
            "branding = %s, sender = %s WHERE id = %s",
            [cfg.ACME_NAME, [cfg.ACME_HOST], cfg.ACME_DOMAIN, adapt(branding), adapt(sender), bid],
        )
        return bid
    cur.execute(
        "INSERT INTO brands (id, slug, display_name, website_domain, hostnames, is_active, branding, sender) "
        "VALUES (%s, %s, %s, %s, %s, TRUE, %s, %s)",
        [cfg.ACME_BRAND_ID_DEFAULT, cfg.ACME_SLUG, cfg.ACME_NAME, cfg.ACME_DOMAIN, [cfg.ACME_HOST],
         adapt(branding), adapt(sender)],
    )
    return cfg.ACME_BRAND_ID_DEFAULT


def _ensure_user(cur, spec: dict, password_hash: Optional[str], platform: bool) -> str:
    row = cur.execute(
        "INSERT INTO sales_reps (email, full_name, password_hash, role, is_active, is_platform_admin) "
        "VALUES (%s, %s, %s, 'admin', TRUE, %s) "
        "ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, "
        "password_hash = EXCLUDED.password_hash, is_active = TRUE, "
        "is_platform_admin = EXCLUDED.is_platform_admin RETURNING id",
        [spec["email"], spec["full_name"], password_hash, platform],
    ).fetchone()
    return str(row["id"])


def _set_memberships(cur, user_id: str, wanted: List[tuple]) -> None:
    """Exactly these memberships, nothing else (removes anything a probe added)."""
    cur.execute("DELETE FROM brand_members WHERE sales_rep_id = %s", [user_id])
    for i, (brand_id, role) in enumerate(wanted):
        cur.execute(
            "INSERT INTO brand_members (brand_id, sales_rep_id, role, is_default) VALUES (%s, %s, %s, %s)",
            [brand_id, user_id, role, i == 0],
        )


# ---------------------------------------------------------------------------
# Tenant rows
# ---------------------------------------------------------------------------

def _seed_acme(cur, acme: str, users: Dict[str, str]) -> None:
    now = datetime.now(timezone.utc)
    T = cfg.ACME_TEXT
    D = cfg.ACME_DOMAIN
    # triggers (e.g. the stakeholder audit trigger) rely on the app.brand_id default
    cur.execute("SELECT set_config('app.brand_id', %s, true)", [acme])
    _upsert(cur, "scraping_jobs", {
        "id": A["job"], "job_name": f"{T} job", "search_query": f"{T} query", "status": "completed",
        "leads_found": 3, "brand_id": acme})
    _upsert(cur, "segments", {
        "id": A["segment_id"], "key": cfg.ACME_SEG, "label": f"{T} segment", "description": T,
        "is_active": True, "sort_order": 1, "brand_id": acme}, natural=("brand_id", "key"))
    _upsert(cur, "segments", {
        "id": A["segment_shared_id"], "key": cfg.SHARED_SEG, "label": f"{T} shared-key segment",
        "description": T, "is_active": True, "sort_order": 2, "brand_id": acme}, natural=("brand_id", "key"))
    _upsert(cur, "email_accounts", {
        "id": A["email_account"], "email": A["account_email"], "display_name": f"{T} Sender",
        "provider": "gmail", "status": "active", "is_active": True, "sender_name": "Acme Iso Sender",
        "sender_title": f"{T} title", "persona": f"{T} persona", "focus_area": T,
        "refresh_token": None, "access_token": None, "brand_id": acme}, natural=("email",))
    _upsert(cur, "campaigns", {
        "id": A["campaign"], "name": f"{T} campaign", "description": T, "email_account_id": A["email_account"],
        "status": "paused", "segment": cfg.ACME_SEG, "target_count": 10, "daily_cap": 1,
        "variants": [{"label": "A", "subject": f"{T} subject", "body": f"{T} body"}],
        "followups": [], "ai_brief": f"{T} brief", "account_manager": f"{T} manager",
        "created_by": f"acme_admin@{D}", "brand_id": acme})
    for n, key in enumerate(("lead", "lead2", "lead3"), start=1):
        _upsert(cur, "scraped_leads", {
            "id": A[key], "job_id": A["job"], "email": f"lead{n}@{D}",
            "decision_maker_name": f"{cfg.ACME_SEARCH} Isolation{n}", "decision_maker_title": "CEO",
            "company_name": T, "industry": T, "status": "new",
            "segment": cfg.SHARED_SEG if n == 3 else cfg.ACME_SEG, "owner": f"{T} owner",
            "brand_id": acme})
    _upsert(cur, "sent_emails", {
        "id": A["sent_email"], "campaign_id": A["campaign"], "email_account_id": A["email_account"],
        "lead_id": A["lead"], "from_email": A["account_email"], "recipient_email": A["sent_recipient"],
        "recipient_name": f"{cfg.ACME_SEARCH} Isolation1", "subject": f"{T} subject",
        "body_html": f"<p>{T}</p>", "body_text": T, "tracking_token": "acmeisotok1",
        "gmail_thread_id": "acme-iso-thread-1", "sent_at": now - timedelta(hours=2),
        "opened_at": now - timedelta(hours=1), "status": "opened", "variant": "A",
        "owner": f"{T} owner", "brand_id": acme})
    _upsert(cur, "email_replies", {
        "id": A["reply"], "sent_email_id": A["sent_email"], "campaign_id": A["campaign"], "lead_id": A["lead"],
        "gmail_message_id": "acme-iso-reply-1", "gmail_thread_id": "acme-iso-thread-1",
        "from_email": A["sent_recipient"], "from_name": f"{cfg.ACME_SEARCH} Isolation1",
        "subject": f"Re: {T} subject", "body_text": f"{T} reply", "received_at": now - timedelta(minutes=30),
        "reviewed": False, "brand_id": acme})
    _upsert(cur, "email_clicks", {
        "id": A["click"], "sent_email_id": A["sent_email"], "campaign_id": A["campaign"], "lead_id": A["lead"],
        "link_url": f"https://{D}/{T}", "clicked_at": now - timedelta(minutes=50), "brand_id": acme})
    _upsert(cur, "email_bounces", {
        "id": A["bounce"], "sent_email_id": A["sent_email"], "email_account_id": A["email_account"],
        "bounce_type": "soft", "bounce_reason": f"{T} bounce", "brand_id": acme})
    _upsert(cur, "email_exclusions", {
        "id": A["exclusion"], "email": A["excluded_email"], "reason": f"{T} exclusion",
        "excluded_by": f"acme_admin@{D}", "brand_id": acme}, natural=("brand_id", "email"))
    _upsert(cur, "email_exclusions", {
        "id": A["exclusion_shared"], "email": cfg.SHARED_EMAIL, "reason": f"{T} shared exclusion",
        "excluded_by": f"acme_admin@{D}", "brand_id": acme}, natural=("brand_id", "email"))
    _upsert(cur, "email_unsubscribes", {
        "id": A["unsub"], "email": f"unsub1@{D}", "source": "manual", "reason": f"{T} unsub",
        "brand_id": acme}, natural=("brand_id", "email"))
    _upsert(cur, "email_ai_settings", {
        "id": A["ai_settings"], "company_name": T, "company_tagline": f"{T} tagline",
        "company_services": f"{T} services", "cta_link_1_label": "Acme demo",
        "cta_link_1_url": f"https://{D}/demo", "cta_link_2_label": "Acme site", "cta_link_2_url": f"https://{D}",
        "email_word_limit": 120, "email_tone": "professional", "ai_prompt_template": f"{T} prompt",
        "brand_id": acme}, natural=("brand_id",))
    _upsert(cur, "scheduler_settings", {
        "id": A["sched_settings"], "is_enabled": False, "daily_limit": 3, "send_hour": 9, "send_minute": 7,
        "timezone": "UTC", "delay_between_emails": 77, "last_run_status": T,
        "last_run_error": f"{T} last error", "brand_id": acme}, natural=("brand_id",))
    _upsert(cur, "scheduler_run_history", {
        "id": A["run"], "started_at": now - timedelta(days=1), "completed_at": now - timedelta(days=1),
        "status": "completed", "leads_attempted": 1, "emails_sent": 1, "emails_failed": 0,
        "error_message": f"{T} run", "brand_id": acme})
    _upsert(cur, "social_media_accounts", {
        "id": A["social"], "platform": "linkedin", "credentials": {"note": T}, "is_connected": True,
        "handle": f"{T}_handle", "brand_id": acme}, natural=("brand_id", "platform"))
    _upsert(cur, "social_media_posts", {
        "id": A["post"], "platform": "linkedin", "content": f"{T} post", "topic": T, "tone": "professional",
        "post_type": "post", "status": "draft", "brand_id": acme})
    _upsert(cur, "stakeholders", {
        "id": A["stakeholder"], "segment_type": "UNASSIGNED", "organization_name": T,
        "primary_contact_name": f"{cfg.ACME_SEARCH} Stake", "email_address": f"stake1@{D}",
        "is_active": True, "brand_id": acme}, natural=("brand_id", "email_address"))
    _upsert(cur, "stakeholder_audit_logs", {
        "log_id": A["audit"], "stakeholder_id": A["stakeholder"], "action": "ACCESS",
        "agent_session_id": T, "changed_fields": {"note": T}, "brand_id": acme}, pk="log_id")
    _upsert(cur, "agent_execution_approvals", {
        "approval_id": A["approval"], "agent_type": "BD_AGENT", "payload": {"note": T},
        "risk_score": 0.5, "status": "PENDING", "brand_id": acme}, pk="approval_id")
    _upsert(cur, "api_keys", {
        "id": A["api_key"], "key_name": f"{T} key", "api_key_encrypted": f"acme-iso-secret-{T}",
        "provider": "serpapi", "usage_count": 0, "usage_limit": 100, "is_active": True,
        "assigned_to": users["acme_admin"], "brand_id": acme})
    _upsert(cur, "form_sessions", {
        "id": A["form_row"], "session_id": A["form_session"], "utm_source": "acme-iso",
        "utm_campaign": T, "sales_rep_name": f"{T} rep", "landing_page": f"https://{D}/form",
        "status": "completed", "brand_id": acme})
    _upsert(cur, "form_responses", {
        "id": A["form_response"], "session_id": A["form_session"], "full_name": f"{cfg.ACME_SEARCH} Form",
        "organization": T, "email": f"form1@{D}", "lead_score": 50, "brand_id": acme})
    _upsert(cur, "tracking_events", {
        "id": A["tracking_event"], "session_id": A["form_session"], "event_type": "page_view",
        "event_data": {"note": T}, "brand_id": acme})
    _upsert(cur, "scraping_logs", {
        "id": A["scrape_log"], "job_id": A["job"], "log_level": "info", "message": f"{T} log",
        "brand_id": acme})
    # staging_legacy_contacts has a serial key: replace the batch wholesale
    cur.execute("DELETE FROM staging_legacy_contacts WHERE brand_id = %s AND raw_data->>'_batch_id' = %s",
                [acme, A["batch"]])
    cur.execute(
        "INSERT INTO staging_legacy_contacts (brand_id, raw_data, migration_status, assigned_segment) "
        "VALUES (%s, %s, 'PENDING', 'UNASSIGNED')",
        [acme, adapt({"_batch_id": A["batch"], "email": f"legacy1@{D}", "name": T})],
    )


def _seed_xw_victims(cur) -> None:
    """Sacrificial brand-1 rows. Paused / inactive so nothing ever sends."""
    now = datetime.now(timezone.utc)
    T = cfg.XW_TEXT
    D = cfg.XW_DOMAIN
    cur.execute("SELECT set_config('app.brand_id', %s, true)", [B1])
    _upsert(cur, "scraping_jobs", {
        "id": X["job"], "job_name": f"{T} job", "search_query": f"{T} query", "status": "completed",
        "leads_found": 0, "brand_id": B1})
    _upsert(cur, "segments", {
        "id": X["segment_id"], "key": cfg.XW_SEG_ONLY, "label": f"{T} only segment", "description": T,
        "is_active": False, "sort_order": 990, "brand_id": B1}, natural=("brand_id", "key"))
    _upsert(cur, "segments", {
        "id": X["segment_shared_id"], "key": cfg.SHARED_SEG, "label": f"{T} shared-key segment",
        "description": T, "is_active": False, "sort_order": 991, "brand_id": B1}, natural=("brand_id", "key"))
    _upsert(cur, "email_accounts", {
        "id": X["email_account"], "email": X["account_email"], "display_name": f"{T} Sender",
        "provider": "gmail", "status": "paused", "is_active": False, "sender_name": "Xw Victim Sender",
        "persona": f"{T} persona", "refresh_token": None, "access_token": None, "brand_id": B1},
        natural=("email",))
    _upsert(cur, "campaigns", {
        "id": X["campaign"], "name": f"{T} victim campaign", "description": T,
        "email_account_id": X["email_account"], "status": "paused", "segment": cfg.XW_SEG_ONLY,
        "target_count": 1, "daily_cap": 1, "variants": [], "followups": [],
        "followup_engaged_only": False, "account_manager": f"{T} manager", "brand_id": B1})
    leads = (("lead", 1, cfg.SHARED_SEG), ("lead2", 2, cfg.SHARED_SEG), ("lead3", 3, cfg.XW_SEG_ONLY))
    for key, n, seg in leads:
        _upsert(cur, "scraped_leads", {
            "id": X[key], "email": f"victim{n}@{D}", "decision_maker_name": f"{cfg.XW_SEARCH} Victim{n}",
            "company_name": T, "status": "archived", "segment": seg, "notes": T, "brand_id": B1})
    _upsert(cur, "sent_emails", {
        "id": X["sent_email"], "campaign_id": X["campaign"], "email_account_id": X["email_account"],
        "lead_id": X["lead"], "from_email": X["account_email"], "recipient_email": X["sent_recipient"],
        "recipient_name": f"{cfg.XW_SEARCH} Victim1", "subject": f"{T} subject", "body_text": T,
        "tracking_token": "xwisotok1", "sent_at": now - timedelta(days=400), "status": "sent",
        "replied_at": None, "variant": "A", "brand_id": B1})
    _upsert(cur, "email_replies", {
        "id": X["reply"], "sent_email_id": X["sent_email"], "campaign_id": X["campaign"], "lead_id": X["lead"],
        "gmail_message_id": "xw-iso-reply-1", "from_email": X["sent_recipient"], "subject": f"Re: {T}",
        "body_text": f"{T} reply", "received_at": now - timedelta(days=399), "reviewed": False, "brand_id": B1})
    _upsert(cur, "email_exclusions", {
        "id": X["exclusion"], "email": X["excluded_email"], "reason": f"{T} exclusion", "brand_id": B1},
        natural=("brand_id", "email"))
    _upsert(cur, "email_exclusions", {
        "id": X["exclusion_shared"], "email": cfg.SHARED_EMAIL, "reason": f"{T} shared exclusion",
        "brand_id": B1}, natural=("brand_id", "email"))
    _upsert(cur, "scheduler_run_history", {
        "id": X["run"], "started_at": now - timedelta(days=400), "completed_at": now - timedelta(days=400),
        "status": "completed", "leads_attempted": 0, "emails_sent": 0, "error_message": f"{T} run",
        "brand_id": B1})
    _upsert(cur, "social_media_posts", {
        "id": X["post"], "platform": "linkedin", "content": f"{T} post", "status": "draft", "brand_id": B1})
    _upsert(cur, "stakeholders", {
        "id": X["stakeholder"], "segment_type": "UNASSIGNED", "organization_name": T,
        "email_address": f"stake1@{D}", "is_active": False, "brand_id": B1},
        natural=("brand_id", "email_address"))
    _upsert(cur, "agent_execution_approvals", {
        "approval_id": X["approval"], "agent_type": "BD_AGENT", "payload": {"note": T}, "status": "PENDING",
        "brand_id": B1}, pk="approval_id")
    _upsert(cur, "api_keys", {
        "id": X["api_key"], "key_name": f"{T} key", "api_key_encrypted": f"xw-iso-secret-{T}",
        "provider": "serpapi", "usage_count": 0, "usage_limit": 1, "is_active": False, "brand_id": B1})


def seed(dry_run: bool = False) -> dict:
    """Create/refresh every fixture. Returns discover() output.

    Idempotent and self-healing: it first scrubs whatever an earlier (possibly
    crashed) run or an earlier step of this run left behind - every acme row
    (fixture or app-created, e.g. auto-exclusions, default social accounts,
    audit rows), probe rows/users/brand - and then rebuilds the canonical
    state. Brand acme and the test users are reused, never duplicated."""
    resolve_brand1_slug()   # fails early, with a clear message, on an un-migrated DB
    with owner_conn() as conn:
        trg = triggers_off(conn)
        with conn.cursor() as cur:
            _scrub(cur, [], strict=False)
        if trg:
            triggers_on(conn)   # fixture inserts get their normal triggers
        with conn.cursor() as cur:
            acme = _ensure_acme(cur)
            pw = _hash(cfg.PASSWORD)
            users: Dict[str, str] = {}
            for name, spec in cfg.USERS.items():
                users[name] = _ensure_user(cur, spec, pw, spec["platform"])
                wanted = [(acme if b == "acme" else B1, role) for b, role in spec["memberships"]]
                _set_memberships(cur, users[name], wanted)
            legacy = _ensure_user(cur, cfg.LEGACY_USER, None, False)
            _set_memberships(cur, legacy, [(B1, "viewer")])
            _seed_acme(cur, acme, users)
            _seed_xw_victims(cur)
        if dry_run:
            conn.rollback()
            return {"acme_brand_id": acme, "dry_run": True}
        conn.commit()
    return discover()


# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

# children before parents
_VICTIM_DELETES = [
    ("email_replies", "id", [X["reply"]]),
    ("email_replies", "sent_email_id", [X["sent_email"]]),
    ("email_clicks", "sent_email_id", [X["sent_email"]]),
    ("sent_emails", "id", [X["sent_email"]]),
    ("scraped_leads", "id", [X["lead"], X["lead2"], X["lead3"]]),
    ("campaigns", "id", [X["campaign"]]),
    ("email_accounts", "id", [X["email_account"]]),
    ("segments", "id", [X["segment_id"], X["segment_shared_id"]]),
    ("email_exclusions", "id", [X["exclusion"], X["exclusion_shared"]]),
    ("scheduler_run_history", "id", [X["run"]]),
    ("social_media_posts", "id", [X["post"]]),
    ("stakeholder_audit_logs", "stakeholder_id", [X["stakeholder"]]),   # written by a trigger
    ("stakeholders", "id", [X["stakeholder"]]),
    ("agent_execution_approvals", "approval_id", [X["approval"]]),
    ("api_keys", "id", [X["api_key"]]),
    ("scraping_jobs", "id", [X["job"]]),
]

# rows an API probe could have created (in any brand) if a check failed
_PROBE_DELETES = [
    ("campaigns", "name LIKE %s", [f"%{cfg.PROBE_TEXT}%"]),
    ("segments", "key LIKE %s OR label LIKE %s", ["mb_iso_probe%", f"%{cfg.PROBE_TEXT}%"]),
    ("email_exclusions", "email LIKE %s", [f"%@{cfg.PROBE_DOMAIN}"]),
    ("api_keys", "key_name LIKE %s", [f"%{cfg.PROBE_TEXT}%"]),
    ("stakeholders", "email_address LIKE %s", [f"%@{cfg.PROBE_DOMAIN}"]),
    ("social_media_posts", "content LIKE %s", [f"%{cfg.PROBE_TEXT}%"]),
    ("scraped_leads", "email LIKE %s", [f"%@{cfg.PROBE_DOMAIN}"]),
]


def _tenant_tables(cur) -> List[str]:
    try:
        from database.tenancy import TENANT_TABLES
        names = set(TENANT_TABLES)
    except Exception:
        names = set()
    rows = cur.execute(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'brand_id' "
        "WHERE n.nspname = 'public' AND c.relkind = 'r'"
    ).fetchall()
    return sorted((names | {r["relname"] for r in rows}) - {"analytics_overview", "brand_members", "brands"})


def _wipe_brand_rows(cur, brand_id: str, label: str, done: List[str]) -> List[str]:
    """Delete every tenant row of one brand (not the brand row, not its
    memberships). FK-order agnostic. Returns the tables that could not be
    emptied (only possible when triggers could not be switched off)."""
    tables = _tenant_tables(cur)
    pending = list(tables)
    for _ in range(len(tables) + 1):
        failed = []
        for t in pending:
            cur.execute("SAVEPOINT mbclean")
            try:
                cur.execute(f"DELETE FROM {t} WHERE brand_id = %s", [brand_id])
                n = cur.rowcount
                cur.execute("RELEASE SAVEPOINT mbclean")
                if n:
                    done.append(f"{t}: {n} {label} row(s) deleted")
            except Exception:
                cur.execute("ROLLBACK TO SAVEPOINT mbclean")
                failed.append(t)
        pending = failed
        if not pending:
            break
    # global suppression entries this brand's activity produced
    cur.execute("SAVEPOINT mbclean")
    try:
        cur.execute("DELETE FROM global_suppression WHERE source_brand_id = %s", [brand_id])
        n = cur.rowcount
        cur.execute("RELEASE SAVEPOINT mbclean")
        if n:
            done.append(f"global_suppression: {n} {label} row(s) deleted")
    except Exception:
        cur.execute("ROLLBACK TO SAVEPOINT mbclean")
    return pending


def _exec_with_triggers(cur, sql: str, params: Sequence[Any]) -> int:
    """Run one statement with triggers ON even inside a triggers_off()
    transaction: FK ON DELETE CASCADE / SET NULL actions are triggers, so
    deleting accounts or brands in replica mode would leave dangling rows."""
    role = cur.execute("SELECT current_setting('session_replication_role') AS r").fetchone()["r"]
    if role not in ("origin", "replica", "local"):
        role = "origin"
    if role != "origin":
        cur.execute("SET LOCAL session_replication_role = origin")
    cur.execute(sql, list(params))
    n = cur.rowcount
    if role != "origin":
        cur.execute(f"SET LOCAL session_replication_role = {role}")
    return n


def _scrub(cur, done: List[str], strict: bool) -> None:
    """Everything a run leaves behind EXCEPT brand acme itself, the test users
    and their memberships: probe rows / accounts / brand, cross-brand
    memberships a probe added, and every acme tenant row (seed() rebuilds the
    canonical ones). strict=True raises when acme rows could not be deleted."""
    cur.execute("DELETE FROM stakeholder_audit_logs WHERE stakeholder_id IN "
                "(SELECT id FROM stakeholders WHERE email_address LIKE %s)", [f"%@{cfg.PROBE_DOMAIN}"])
    for table, where, params in _PROBE_DELETES:
        cur.execute(f"DELETE FROM {table} WHERE {where}", params)
        if cur.rowcount:
            done.append(f"{table}: {cur.rowcount} probe row(s)")
    # probe-created accounts (e.g. a member a failed RBAC check added); memberships cascade
    n = _exec_with_triggers(cur, "DELETE FROM sales_reps WHERE email LIKE %s", [f"%@{cfg.PROBE_DOMAIN}"])
    if n:
        done.append(f"sales_reps: {n} probe account(s)")
    # a brand a failed "create brand" probe created (only if its restore failed)
    probe_brand = cur.execute("SELECT id::text AS id FROM brands WHERE slug = %s", [cfg.PROBE_BRAND_SLUG]).fetchone()
    if probe_brand:
        left = _wipe_brand_rows(cur, probe_brand["id"], "probe-brand", done)
        if not left:
            _exec_with_triggers(cur, "DELETE FROM brands WHERE id = %s", [probe_brand["id"]])
            done.append(f"probe brand {cfg.PROBE_BRAND_SLUG} deleted")
        else:
            done.append(f"WARNING: probe brand {cfg.PROBE_BRAND_SLUG} kept, rows left in {left}")
    acme = cur.execute("SELECT id::text AS id FROM brands WHERE slug = %s", [cfg.ACME_SLUG]).fetchone()
    if acme:
        # brand-1 users a probe may have added to acme
        cur.execute(
            "DELETE FROM brand_members WHERE brand_id = %s AND sales_rep_id IN "
            "(SELECT id FROM sales_reps WHERE email LIKE %s)", [acme["id"], f"%@{cfg.XW_DOMAIN}"])
        left = _wipe_brand_rows(cur, acme["id"], "acme", done)
        if left:
            if strict:
                raise RuntimeError(f"could not delete acme rows from: {left}")
            done.append(f"WARNING: acme rows left in {left} (seed upserts over them)")


def cleanup(full: bool = False) -> List[str]:
    """Remove victims, probe rows and every acme tenant row (brand acme, the
    test users and their memberships are kept for the next run, which re-seeds
    the rows); full=True also removes brand acme + the test users."""
    done: List[str] = []
    with owner_conn() as conn:
        # the stakeholder audit trigger would write (brand-less) audit rows that
        # then block the delete; run cleanup with triggers off when possible
        if not triggers_off(conn):
            done.append("WARNING: owner is not superuser - triggers stay on (stakeholder rows may not delete)")
        with conn.cursor() as cur:
            for table, col, ids in _VICTIM_DELETES:
                cur.execute(f"DELETE FROM {table} WHERE {col}::text = ANY(%s)", [ids])
                if cur.rowcount:
                    done.append(f"{table}: {cur.rowcount} victim row(s)")
            _scrub(cur, done, strict=full)
            if full:
                acme = cur.execute("SELECT id FROM brands WHERE slug = %s", [cfg.ACME_SLUG]).fetchone()
                if acme:
                    _exec_with_triggers(cur, "DELETE FROM brands WHERE id = %s", [acme["id"]])
                    done.append("brand acme deleted")
                emails = [u["email"] for u in cfg.USERS.values()] + [cfg.LEGACY_USER["email"]]
                n = _exec_with_triggers(cur, "DELETE FROM sales_reps WHERE email = ANY(%s)", [emails])
                done.append(f"test users deleted: {n}")
        conn.commit()
    return done


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

def resolve_brand1_slug() -> str:
    """Brand 1's slug as stored in the database (it is 'default' on a fresh
    install but an operator may have renamed it). Updates cfg.BRAND1_SLUG."""
    rows = q("SELECT slug FROM brands WHERE id = %s", [B1])
    if not rows:
        raise RuntimeError(
            f"brand 1 ({B1}) is missing - start the backend once so the multi-brand "
            "migration (database/multibrand.sql) runs before using this suite")
    cfg.BRAND1_SLUG = rows[0]["slug"]
    return cfg.BRAND1_SLUG


def discover() -> dict:
    """Ids of fixture users/brands + real brand-1 markers (read-only).

    Brand-1 markers are data-driven: whatever mailboxes, campaigns, recipients
    and leads brand 1 holds in THIS database. On a fresh install they are
    empty and the suite relies on the sacrificial victim rows (XW_* markers)."""
    resolve_brand1_slug()
    acme = q("SELECT id::text AS id FROM brands WHERE slug = %s", [cfg.ACME_SLUG])
    users = {
        name: (q("SELECT id::text AS id FROM sales_reps WHERE email = %s", [spec["email"]]) or [{}])[0].get("id")
        for name, spec in {**cfg.USERS, "xw_legacy": cfg.LEGACY_USER}.items()
    }
    victims = [X["email_account"], X["campaign"]]
    personas = [r["email"] for r in q(
        "SELECT email FROM email_accounts WHERE brand_id = %s AND NOT (id::text = ANY(%s)) ORDER BY email",
        [B1, victims])]
    camps = q(
        "SELECT id::text AS id, name FROM campaigns WHERE brand_id = %s AND NOT (id::text = ANY(%s)) "
        "ORDER BY created_at DESC LIMIT 20", [B1, victims])
    account_ids = [r["id"] for r in q(
        "SELECT id::text AS id FROM email_accounts WHERE brand_id = %s AND NOT (id::text = ANY(%s))",
        [B1, victims])]
    recipients = [r["recipient_email"] for r in q(
        "SELECT recipient_email FROM sent_emails WHERE brand_id = %s AND recipient_email LIKE '%%@%%' "
        "AND recipient_email NOT LIKE %s ORDER BY sent_at DESC NULLS LAST LIMIT 8",
        [B1, f"%@{cfg.XW_DOMAIN}"])]
    lead_emails = [r["email"] for r in q(
        "SELECT email FROM scraped_leads WHERE brand_id = %s AND email LIKE '%%@%%' AND email NOT LIKE %s "
        "ORDER BY created_at DESC NULLS LAST LIMIT 8", [B1, f"%@{cfg.XW_DOMAIN}"])]
    other_brands = [r["id"] for r in q("SELECT id::text AS id FROM brands WHERE slug NOT IN (%s, %s)",
                                       [cfg.ACME_SLUG, cfg.BRAND1_SLUG])]

    def good_name(n: str) -> bool:
        # only distinctive names (a campaign called "template" is not a marker)
        return bool(n) and len(n) >= 12 and any(ch in n for ch in " -_")

    real_markers = sorted({*personas, *recipients, *lead_emails,
                           *[c["name"] for c in camps if good_name(c["name"])],
                           *[c["id"] for c in camps], *account_ids})
    return {
        "acme_brand_id": acme[0]["id"] if acme else None,
        "users": users,
        "brand1_personas": personas,
        "brand1_campaigns": camps,
        "brand1_account_ids": account_ids,
        "brand1_real_markers": real_markers,
        "other_brand_ids": other_brands,
    }


def main(argv: List[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "show"
    if cmd == "seed":
        out = seed(dry_run="--dry-run" in argv)
        print("seeded" + (" (DRY RUN, rolled back)" if out.get("dry_run") else ""), out.get("acme_brand_id"))
        return 0
    if cmd == "cleanup":
        for line in cleanup(full="--all" in argv):
            print(" -", line)
        print("cleanup done")
        return 0
    if cmd == "show":
        import json
        print(json.dumps(discover(), indent=2, default=str))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
