"""
Cross-brand isolation checks. Each check_*() records rows in the shared
Report and raises AssertionError when it found a LEAK / FAIL (or WEAK with
MB_STRICT=1). They are called by test_isolation.py (pytest) and by
run_isolation.py (no pytest needed), in this order:

    sanity      fixtures visible to their own brand (else every other result is vacuous)
    public      public endpoints work without auth and stay brand-correct
    unauth      every protected route answers 401/403 without a token
    rls         Postgres RLS / app_rw role / composite-FK backstops
    sweep       every GET route, as each brand's admin, never shows the other brand's markers
    byid        brand-B objects attacked by id from brand A: 4xx AND the DB row unchanged
    members     cross-brand account/membership attacks (password reset, legacy-claim, roles)
    rbac        a brand-1 VIEWER is refused create/delete; non-platform admins can't manage brands
    switch      brand switching / login brand / Host pinning / spoofed headers / forged tokens
    secrets     every role: no OAuth tokens in mailbox responses; ai_api_key unmasked for admins only
"""

from __future__ import annotations

import re
import time
import uuid
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence

import mbconfig as cfg
import mbfixtures
from mbapi import Api, Resp, Route, fetch_openapi, login, routes_from, scan, session
from mbdb import Snap, Watch, app_conn, owner_conn, planted, q, snap_ids
from mbreport import REPORT, Report

A = cfg.ACME_IDS
X = cfg.XW_IDS
B1 = cfg.BRAND1_ID

DENIED = {401, 403}
NOT_FOUNDISH = {400, 403, 404}

# GET routes never called by the sweep (side effects outside the brand model)
SWEEP_SKIP = [
    (re.compile(r"^/track/"), "public tracking pixel/click/unsubscribe - records events"),
    (re.compile(r"^/api/unsubscribe"), "public opt-out endpoint - records unsubscribes"),
    (re.compile(r"/google/callback$"), "OAuth callback - exchanges codes with Google"),
]
STREAM_RE = re.compile(r"(stream|/events$)")

# Expected to be reachable without a token (not probed for 401)
PUBLIC_ALLOW = [re.compile(p) for p in (
    r"^/health$", r"^/api/health$", r"^/api/auth/login$", r"^/api/auth/register$", r"^/api/auth/status$",
    r"^/api/brands/public-config$", r"^/track/", r"^/api/unsubscribe$", r"^/api/tracking/", r"^/api/chat$",
    r"^/api/setup/status$", r"^/api/email-accounts/google/callback$",
    # GET only: the login / landing pages load the Host's branding before sign-in
    # (brand-correctness is checked in `public`). POST /api/setup/save and
    # /test-connection stay probed.
    r"^/api/setup/config$",
)]
# Mutating routes never called WITHOUT a token, in case they turn out to be
# open (they could send email, start jobs, call paid APIs...). They get a
# static check instead: the OpenAPI entry must declare the auth header.
UNSAFE_RE = re.compile(
    r"/(start|start-job|run-now|send|send-to-lead|sync-replies|trigger|test|test-provider|test-connection|"
    r"generate|post|alert|toggle|import|preview|ingest-legacy|promote|save|reset|bulk|bulk-delete|"
    r"assign-owner|workflows)(/|$)")


class Ctx:
    """Shared state: fixtures, sessions, OpenAPI routes."""

    def __init__(self, report: Report = REPORT):
        self.report = report
        self.info: Dict[str, Any] = {}
        self.acme_id: str = ""
        self.s: Dict[str, Api] = {}
        self.routes: List[Route] = []
        self.openapi_src = ""
        self.public_get: Dict[str, bool] = {}
        self._ready = False

    # ------------------------------------------------------------------
    def setup(self) -> "Ctx":
        if self._ready:
            return self
        self.info = mbfixtures.seed()
        self.acme_id = self.info["acme_brand_id"]
        self.report.meta.update({"acme_brand_id": self.acme_id, "users": self.info["users"],
                                 "brand1_real_markers": len(self.info["brand1_real_markers"])})
        self._wait_for_brand_cache()
        for name, spec in cfg.USERS.items():
            self.s[name] = session(name, spec["email"])
        doc, src = fetch_openapi()
        self.openapi_src = src
        self.routes = routes_from(doc) if doc else []
        self.report.meta["openapi"] = src
        self.report.meta["routes"] = len(self.routes)
        self._ready = True
        return self

    def _wait_for_brand_cache(self) -> None:
        """The API caches the brand catalog (~30 s). A just-created brand is
        invisible until then: wait until acme_admin's login lands in acme."""
        deadline = time.monotonic() + cfg.BRAND_CACHE_WAIT
        last = None
        while True:
            r, data = login(cfg.USERS["acme_admin"]["email"], cfg.PASSWORD)
            last = r
            if data and (data.get("user") or {}).get("brand_id") == self.acme_id:
                return
            if time.monotonic() > deadline:
                raise RuntimeError(f"acme_admin cannot log in to brand acme (API brand cache?): "
                                   f"{r.status} {r.short(300)}")
            time.sleep(3)

    def reseed(self) -> None:
        mbfixtures.seed()

    def teardown(self) -> None:
        if getattr(self, "_torn_down", False):
            return
        self._torn_down = True
        for api in self.s.values():
            api.close()
        self.s.clear()
        if not cfg.KEEP_FIXTURES:
            try:
                for line in mbfixtures.cleanup(full=False):
                    self.report.add("teardown", "INFO", f"cleanup: {line}")
            except Exception as e:
                self.report.add("teardown", "ERROR", "cleanup failed", detail=f"{type(e).__name__}: {e}")
        self.report.save()

    # ------------------------------------------------------------------
    def side_values(self, side: str) -> Dict[str, List[str]]:
        """param-key -> candidate values for one side ('acme' | 'xw')."""
        ids = A if side == "acme" else X
        vals: Dict[str, List[str]] = {k: [v] for k, v in ids.items() if isinstance(v, str)}
        users = self.info.get("users") or {}
        if side == "acme":
            vals["brand"] = [self.acme_id]
            vals["user"] = [users.get("acme_admin") or str(uuid.uuid4())]
        else:
            vals["brand"] = [B1]
            vals["user"] = [users.get("xw_viewer") or str(uuid.uuid4())]
            vals["form_session"] = [str(uuid.uuid4())]
            camps = [c["id"] for c in self.info.get("brand1_campaigns") or []]
            if camps:
                vals["campaign"] = vals["campaign"] + camps[:1]
            accts = self.info.get("brand1_account_ids") or []
            if accts:
                vals["email_account"] = vals["email_account"] + accts[:1]
        return vals

    def markers(self, side: str, with_brand_id: bool = True) -> List[str]:
        """Strings that must never reach the OTHER brand. with_brand_id=False
        for a platform admin's views (their brand list legitimately names acme)."""
        out = cfg.base_markers(side)
        if side == "acme":
            if with_brand_id:
                out.append(self.acme_id)
        else:
            out += self.info.get("brand1_real_markers") or []
        return [m for m in out if m]


def _fail_if(report: Report, section: str) -> None:
    bad = report.failures(section)
    if bad:
        lines = [f"[{r['verdict']}] {r['what']} :: {r.get('detail') or r.get('diffs') or r.get('markers') or r.get('status')}"
                 for r in bad[:25]]
        raise AssertionError(f"{len(bad)} {section} problem(s):\n  " + "\n  ".join(lines))


def _status_verdict(r: Resp, expected: set, harmless: bool = True) -> str:
    """Verdict for a response whose DATA side already passed."""
    if r.status is None:
        return "ERROR"
    if r.status in expected:
        return "PASS"
    if r.status >= 500 or r.status == 422:
        return "ERROR"
    return "WEAK" if harmless else "FAIL"


# =====================================================================
# sanity
# =====================================================================

def check_sanity(ctx: Ctx) -> None:
    rep = ctx.report
    for name, side, other in (("acme_admin", "acme", "xw"), ("xw_admin", "xw", "acme")):
        api = ctx.s[name]
        me = api.call("GET", "/api/auth/me")
        want = ctx.acme_id if side == "acme" else B1
        got = (me.json() or {}).get("brand_id") if me.ok else None
        rep.add("sanity", "PASS" if got == want else "FAIL", f"{name} /api/auth/me brand_id",
                user=name, status=me.status, detail=f"brand_id={got} expected={want}")
        lst = api.call("GET", "/api/campaigns/list")
        own_marker = f"{cfg.ACME_TEXT} campaign" if side == "acme" else f"{cfg.XW_TEXT} victim campaign"
        sees_own = lst.ok and own_marker.lower() in lst.text.lower()
        rep.add("sanity", "PASS" if sees_own else "FAIL", f"{name} sees its own fixture campaign",
                user=name, status=lst.status,
                detail="" if sees_own else f"'{own_marker}' missing - fixtures invisible; sweep results would be vacuous: {lst.short()}")
        # detector self-test: the scanner must find this brand's OWN markers in its own data
        hits = scan(lst.text, ctx.markers(side))
        rep.add("sanity", "PASS" if hits else "FAIL", f"marker detector finds {side} markers in {name}'s own list",
                detail=f"{len(hits)} marker(s) found" if hits else "scanner found nothing - leak detection is blind")
    if not ctx.routes:
        rep.add("sanity", "FAIL", "OpenAPI route list", detail=ctx.openapi_src)
    else:
        rep.add("sanity", "PASS", f"OpenAPI: {len(ctx.routes)} operations", detail=ctx.openapi_src)
    _fail_if(rep, "sanity")


# =====================================================================
# public
# =====================================================================

def check_public(ctx: Ctx) -> None:
    rep = ctx.report
    anon = Api("anon")
    try:
        r = anon.call("GET", "/api/brands/public-config")
        data = r.json() or {}
        slug = (data.get("brand") or {}).get("slug")
        rep.add("public", "PASS" if r.ok and slug == cfg.BRAND1_SLUG else "FAIL",
                "GET /api/brands/public-config (no auth, default host) -> brand 1",
                status=r.status, detail=f"slug={slug}")
        leaks = scan(r.text, ctx.markers("acme"))
        if leaks:
            rep.add("public", "LEAK", "public-config (default host) shows acme data", markers=leaks)
        r2 = anon.call("GET", "/api/brands/public-config", headers={"Host": cfg.ACME_HOST})
        slug2 = ((r2.json() or {}).get("brand") or {}).get("slug")
        rep.add("public", "PASS" if r2.ok and slug2 == cfg.ACME_SLUG else "FAIL",
                f"public-config with Host: {cfg.ACME_HOST} -> acme", status=r2.status, detail=f"slug={slug2}")
        leaks2 = scan(r2.text, ctx.markers("xw"))
        if leaks2:
            rep.add("public", "LEAK", "public-config for acme's host shows brand-1 data", markers=leaks2)
        # X-Forwarded-Host is client-controlled (nginx forwards the real Host): must be ignored
        r3 = anon.call("GET", "/api/brands/public-config", headers={"X-Forwarded-Host": cfg.ACME_HOST})
        slug3 = ((r3.json() or {}).get("brand") or {}).get("slug")
        rep.add("public", "PASS" if r3.ok and slug3 == cfg.BRAND1_SLUG else "FAIL",
                "spoofed X-Forwarded-Host is ignored by public-config", status=r3.status, detail=f"slug={slug3}")
        bad = anon.call("POST", "/api/auth/login",
                        json_body={"email": cfg.USERS["acme_admin"]["email"], "password": "wrong-password"})
        rep.add("public", "PASS" if bad.status == 401 else "FAIL", "login with a wrong password -> 401",
                status=bad.status)
        h = anon.call("GET", "/api/health")
        rep.add("public", "PASS" if h.ok else "ERROR", "GET /api/health", status=h.status)
        # /api/setup/config is public by design (branding for the login page): it must
        # stay brand-correct - the default host never shows acme, acme's host never brand 1
        sc = anon.call("GET", "/api/setup/config")
        leaks = scan(sc.text, ctx.markers("acme"))
        rep.add("public", "LEAK" if leaks else ("PASS" if sc.ok else "ERROR"),
                "GET /api/setup/config (no auth, default host) shows no acme data",
                status=sc.status, markers=leaks)
        sc2 = anon.call("GET", "/api/setup/config", headers={"Host": cfg.ACME_HOST})
        leaks2 = scan(sc2.text, ctx.markers("xw"))
        if leaks2:
            rep.add("public", "LEAK", f"GET /api/setup/config with Host: {cfg.ACME_HOST} shows brand-1 data",
                    status=sc2.status, markers=leaks2)
        else:
            own = sc2.ok and cfg.ACME_TEXT.lower() in sc2.text.lower()
            rep.add("public", "PASS" if own else "FAIL",
                    f"GET /api/setup/config with Host: {cfg.ACME_HOST} -> acme branding", status=sc2.status,
                    detail="" if own else f"acme's company name missing: {sc2.short()}")
    finally:
        anon.close()
    _fail_if(rep, "public")


# =====================================================================
# unauthenticated access
# =====================================================================

def check_unauth(ctx: Ctx) -> None:
    rep = ctx.report
    anon = Api("anon")
    bogus = Api("bogus-token", token="not-a-jwt")
    try:
        for rt in ctx.routes:
            if any(p.search(rt.path) for p in PUBLIC_ALLOW):
                rep.add("unauth", "SKIP", rt.key, detail="public by design (allow-list)")
                continue
            if rt.method == "GET" and any(p.search(rt.path) for p, _ in SWEEP_SKIP):
                rep.add("unauth", "SKIP", rt.key, detail="side-effecting public GET")
                continue
            unsafe = rt.method != "GET" and (UNSAFE_RE.search(rt.path) or (not rt.path_params and not rt.body_required))
            if unsafe:
                verdict = "PASS" if rt.declares_auth_header else "FAIL"
                rep.add("unauth", verdict, rt.key,
                        detail="static: OpenAPI declares the auth header (not called: unsafe to call if it were open)"
                        if verdict == "PASS" else
                        "no auth dependency visible in OpenAPI (not called live: mutating route without id/body)")
                continue
            path = rt.fill({})  # random ids, never a real row
            stream = STREAM_RE.search(rt.path) is not None
            for who, api in (("no token", anon), ("garbage token", bogus)):
                r = api.call(rt.method, path, stream_seconds=3 if stream else None)
                if r.status in DENIED:
                    verdict = "PASS"
                elif r.status is None:
                    verdict = "ERROR"
                else:
                    verdict = "FAIL"
                rep.add("unauth", verdict, f"{rt.key} [{who}]", status=r.status,
                        detail="" if verdict == "PASS" else f"expected 401: {r.short()}")
    finally:
        anon.close()
        bogus.close()
    _fail_if(rep, "unauth")


# =====================================================================
# RLS / database backstops
# =====================================================================

def check_rls(ctx: Ctx) -> None:
    rep = ctx.report
    acme = ctx.acme_id
    try:
        from database.tenancy import TENANT_TABLES
        tables = sorted(TENANT_TABLES)
    except Exception as e:
        rep.add("rls", "ERROR", "import database.tenancy", detail=str(e))
        tables = ["scraped_leads", "campaigns", "sent_emails", "segments", "email_exclusions", "email_accounts"]

    # 1) table flags (owner view)
    flags = {r["relname"]: r for r in q(
        "SELECT c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, "
        "(SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies "
        "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = 'public' AND c.relname = ANY(%s)", [tables])}
    for t in tables:
        f = flags.get(t)
        if not f:
            rep.add("rls", "FAIL", f"{t}: table/view missing")
        elif f["relkind"] == "v":
            rep.add("rls", "INFO", f"{t}: view (relies on security_invoker + base-table RLS)")
        elif not (f["relrowsecurity"] and f["policies"]):
            rep.add("rls", "FAIL", f"{t}: RLS enabled={f['relrowsecurity']} policies={f['policies']}")
        else:
            rep.add("rls", "PASS", f"{t}: RLS on, {f['policies']} polic(ies), force={f['relforcerowsecurity']}")

    try:
        with app_conn() as conn:
            role = conn.execute("SELECT current_user AS u, r.rolsuper, r.rolbypassrls FROM pg_roles r "
                                "WHERE r.rolname = current_user").fetchone()
            ok = role and not role["rolsuper"] and not role["rolbypassrls"]
            rep.add("rls", "PASS" if ok else "FAIL", f"app role {role and role['u']} is not superuser / BYPASSRLS",
                    detail=str(role))

            def per_table(brand: str, label: str, check: Callable[[dict], Optional[str]], sql: str, params=()):
                for t in tables:
                    conn.execute("SAVEPOINT mbrls")
                    try:
                        conn.execute("SELECT set_config('app.brand_id', %s, true), "
                                     "set_config('app.tenancy_bypass', 'off', true)", [brand])
                        row = conn.execute(sql.format(t=t), list(params)).fetchone()
                        problem = check(row)
                        rep.add("rls", "FAIL" if problem else "PASS", f"{t}: {label}", detail=problem or "")
                    except Exception as e:
                        rep.add("rls", "ERROR", f"{t}: {label}", detail=f"{type(e).__name__}: {str(e)[:200]}")
                    finally:
                        conn.execute("ROLLBACK TO SAVEPOINT mbrls")

            per_table("", "no app.brand_id -> 0 rows",
                      lambda r: None if r["n"] == 0 else f"{r['n']} rows visible with no brand bound",
                      "SELECT count(*) AS n FROM {t}")
            per_table(acme, "app.brand_id=acme -> only acme rows",
                      lambda r: None if r["foreign"] == 0 else f"{r['foreign']} non-acme rows visible",
                      "SELECT count(*) FILTER (WHERE brand_id IS DISTINCT FROM %s::uuid) AS foreign FROM {t}", [acme])
            per_table(B1, "app.brand_id=brand1 -> only brand-1 rows",
                      lambda r: None if r["foreign"] == 0 else f"{r['foreign']} non-brand-1 rows visible",
                      "SELECT count(*) FILTER (WHERE brand_id IS DISTINCT FROM %s::uuid) AS foreign FROM {t}", [B1])

            # concrete expectations on scraped_leads
            def scoped(sql: str, params: Sequence[Any], brand: str):
                conn.execute("SAVEPOINT mbq")
                try:
                    conn.execute("SELECT set_config('app.brand_id', %s, true), "
                                 "set_config('app.tenancy_bypass', 'off', true)", [brand])
                    cur = conn.execute(sql, list(params))
                    return (cur.fetchall() if cur.description else None), cur.rowcount, None
                except Exception as e:
                    return None, -1, e
                finally:
                    conn.execute("ROLLBACK TO SAVEPOINT mbq")

            rows, _, err = scoped("SELECT count(*) AS n FROM scraped_leads WHERE email LIKE %s",
                                  [f"%@{cfg.ACME_DOMAIN}"], acme)
            n = rows[0]["n"] if rows else None
            rep.add("rls", "PASS" if n == 3 else "FAIL", "acme sees exactly its 3 fixture leads",
                    detail=f"n={n} err={err}")
            rows, _, err = scoped("SELECT count(*) AS n FROM scraped_leads WHERE email LIKE %s",
                                  [f"%@{cfg.ACME_DOMAIN}"], B1)
            n = rows[0]["n"] if rows else None
            rep.add("rls", "PASS" if n == 0 else "FAIL", "brand 1 sees none of acme's leads", detail=f"n={n} err={err}")

            _, cnt, err = scoped("UPDATE scraped_leads SET notes = 'pwned' WHERE id = %s", [X["lead"]], acme)
            rep.add("rls", "PASS" if cnt == 0 and not err else ("PASS" if err else "FAIL"),
                    "acme UPDATE of a brand-1 lead affects 0 rows", detail=f"rowcount={cnt} err={err}")
            _, cnt, err = scoped("DELETE FROM scraped_leads WHERE id = %s", [X["lead"]], acme)
            rep.add("rls", "PASS" if cnt == 0 or err else "FAIL", "acme DELETE of a brand-1 lead affects 0 rows",
                    detail=f"rowcount={cnt} err={err}")
            _, cnt, err = scoped("INSERT INTO scraped_leads (email, company_name, brand_id) VALUES (%s, 'x', %s)",
                                 [f"rls-probe@{cfg.ACME_DOMAIN}", B1], acme)
            rep.add("rls", "PASS" if err else "FAIL", "acme INSERT stamped with brand 1 is rejected (WITH CHECK)",
                    detail=f"err={type(err).__name__ if err else None} rowcount={cnt}")
            _, cnt, err = scoped("UPDATE scraped_leads SET brand_id = %s WHERE id = %s", [B1, A["lead"]], acme)
            rep.add("rls", "PASS" if err or cnt == 0 else "FAIL", "acme cannot move its row into brand 1",
                    detail=f"err={type(err).__name__ if err else None} rowcount={cnt}")
            rows, cnt, err = scoped("INSERT INTO scraped_leads (email, company_name) VALUES (%s, 'x') RETURNING brand_id::text AS b",
                                    [f"rls-default@{cfg.ACME_DOMAIN}"], acme)
            got = rows[0]["b"] if rows else None
            rep.add("rls", "PASS" if got == acme else "FAIL", "brand_id DEFAULT comes from app.brand_id",
                    detail=f"brand_id={got} err={err}")
            _, _, err = scoped("INSERT INTO scraped_leads (email, company_name) VALUES (%s, 'x')",
                               [f"rls-nobrand@{cfg.ACME_DOMAIN}"], "")
            rep.add("rls", "PASS" if err else "FAIL", "INSERT with no brand bound fails", detail=f"err={err}")
            # no DDL for the app role
            for ddl in ("CREATE TABLE mb_iso_ddl_probe (x int)",
                        "ALTER TABLE scraped_leads DISABLE ROW LEVEL SECURITY",
                        "DROP POLICY IF EXISTS brand_isolation_v1 ON scraped_leads"):
                _, _, err = scoped(ddl, [], acme)
                rep.add("rls", "PASS" if err else "FAIL", f"app role cannot run DDL: {ddl.split(' (')[0][:60]}",
                        detail=f"err={type(err).__name__ if err else None}")
            # informational: the bypass switch is a session setting the role can flip
            conn.execute("SAVEPOINT mbbyp")
            try:
                conn.execute("SELECT set_config('app.brand_id', %s, true), "
                             "set_config('app.tenancy_bypass', 'on', true)", [acme])
                n = conn.execute("SELECT count(*) AS n FROM scraped_leads WHERE brand_id = %s::uuid", [B1]).fetchone()["n"]
                if n:
                    rep.add("rls", "INFO", "app_rw can switch app.tenancy_bypass on itself (by design, for "
                            "system_scope): RLS stops unscoped app queries, not SQL injection",
                            detail=f"brand-1 rows visible with bypass on: {n}")
            except Exception as e:
                rep.add("rls", "INFO", "app_rw cannot enable the tenancy bypass", detail=type(e).__name__)
            finally:
                conn.execute("ROLLBACK TO SAVEPOINT mbbyp")
            conn.rollback()
    except Exception as e:
        rep.add("rls", "ERROR", "app_rw connection", detail=f"{type(e).__name__}: {e} (MB_APP_DSN={cfg.APP_DSN})")

    # composite (id, brand_id) foreign keys: a child cannot point at another brand's parent
    fk_probes = [
        ("sent_emails -> brand-1 campaign",
         "INSERT INTO sent_emails (campaign_id, recipient_email, subject, brand_id) VALUES (%s, %s, 'fk', %s)",
         [X["campaign"], f"fk@{cfg.ACME_DOMAIN}", acme]),
        ("campaigns -> brand-1 mailbox",
         "INSERT INTO campaigns (name, email_account_id, brand_id) VALUES ('fk probe', %s, %s)",
         [X["email_account"], acme]),
        ("email_replies -> brand-1 sent email",
         "INSERT INTO email_replies (sent_email_id, gmail_message_id, from_email, received_at, brand_id) "
         "VALUES (%s, 'fk-probe', 'x@y.z', now(), %s)", [X["sent_email"], acme]),
        ("scraped_leads -> brand-1 scraping job",
         "INSERT INTO scraped_leads (email, job_id, brand_id) VALUES (%s, %s, %s)",
         [f"fk2@{cfg.ACME_DOMAIN}", X["job"], acme]),
    ]
    with owner_conn() as conn:
        for label, sql, params in fk_probes:
            conn.execute("SAVEPOINT mbfk")
            try:
                conn.execute(sql, params)
                rep.add("rls", "FAIL", f"composite FK: {label} accepted")
            except Exception as e:
                rep.add("rls", "PASS", f"composite FK: {label} rejected", detail=type(e).__name__)
            finally:
                conn.execute("ROLLBACK TO SAVEPOINT mbfk")
        conn.rollback()
    _fail_if(rep, "rls")


# =====================================================================
# generic GET leak sweep
# =====================================================================

def _sweep_one(ctx: Ctx, rep: Report, rt: Route, user: str, api: Api, own: Dict[str, List[str]],
               foreign: Dict[str, List[str]], markers: List[str], public: bool, other_side: str) -> None:
    stream = STREAM_RE.search(rt.path) is not None

    def values_for(params: Iterable[str], src: Dict[str, List[str]], fallback: Dict[str, List[str]]):
        out, unmapped = {}, []
        for p in params:
            keys = cfg.PARAM_MAP.get(p)
            if not keys:
                unmapped.append(p)
                continue
            v = next((src[k][0] for k in keys if src.get(k)), None) or \
                next((fallback[k][0] for k in keys if fallback.get(k)), None)
            if v is None:
                unmapped.append(p)
            else:
                out[p] = v
        return out, unmapped

    base, unmapped = values_for(rt.path_params, own, own)
    variants: List[tuple] = [("own", base, {})]
    for p in rt.path_params:
        for k in cfg.PARAM_MAP.get(p, []):
            for v in foreign.get(k, [])[:2]:
                if v != base.get(p):
                    variants.append((f"foreign {p}={k}", {**base, p: v}, {}))
    for qp in rt.query_params:
        name = qp["name"]
        if name not in cfg.QUERY_PROBE_PARAMS:
            continue
        for k in cfg.PARAM_MAP.get(name, []):
            if foreign.get(k):
                variants.append((f"query {name}={k}", base, {name: foreign[k][0]}))
                break
    for label, pvals, qvals in variants[:10]:
        path = rt.fill(pvals)
        r = api.call("GET", path, params=qvals or None, stream_seconds=3 if stream else None)
        scrub = list(pvals.values()) + list(qvals.values())
        found = scan(r.text, markers, scrub)
        what = f"{rt.key} [{user} {label}]"
        if found:
            # brand-1 is the default public brand: its public data on a public route is not a leak
            if public and other_side == "xw":
                rep.add("sweep", "INFO", what, user=user, status=r.status, markers=found,
                        detail="public route shows default-brand (brand 1) data")
            else:
                rep.add("sweep", "LEAK", what, user=user, status=r.status, markers=found, url=path, query=qvals)
        elif r.status is None or r.status >= 500:
            rep.add("sweep", "ERROR", what, user=user, status=r.status, detail=r.short(200))
        else:
            extra = f"unmapped path params {unmapped} (random ids used)" if unmapped and label == "own" else ""
            if label.startswith("foreign") and r.ok:
                extra = (extra + " " if extra else "") + "foreign id answered 2xx (no markers in body)"
            rep.add("sweep", "PASS", what, user=user, status=r.status, detail=extra)


def check_sweep(ctx: Ctx) -> None:
    rep = ctx.report
    acme_vals, xw_vals = ctx.side_values("acme"), ctx.side_values("xw")
    gets = [rt for rt in ctx.routes if rt.method == "GET"]
    anon = Api("anon")
    try:
        for rt in gets:
            skip = next((why for p, why in SWEEP_SKIP if p.search(rt.path)), None)
            if skip:
                rep.add("sweep", "SKIP", rt.key, detail=skip)
                continue
            stream = STREAM_RE.search(rt.path) is not None
            # anonymous call: decides "public", and the public must never see acme data
            pvals = {p: (xw_vals.get((cfg.PARAM_MAP.get(p) or ["?"])[0]) or [str(uuid.uuid4())])[0]
                     for p in rt.path_params}
            ra = anon.call("GET", rt.fill(pvals), stream_seconds=3 if stream else None)
            public = ra.ok
            if public:
                found = scan(ra.text, ctx.markers("acme"), list(pvals.values()))
                rep.add("sweep", "LEAK" if found else "PASS", f"{rt.key} [anonymous]", status=ra.status,
                        markers=found, detail="public route")
            for user, own, foreign, other in (("xw_admin", xw_vals, acme_vals, "acme"),
                                              ("acme_admin", acme_vals, xw_vals, "xw")):
                _sweep_one(ctx, rep, rt, user, ctx.s[user], own, foreign, ctx.markers(other), public, other)
    finally:
        anon.close()
    _fail_if(rep, "sweep")


# =====================================================================
# by-id attacks (acme_admin -> brand-1 victim rows)
# =====================================================================

def _snaps_campaign() -> List[Snap]:
    return [snap_ids("campaigns", [X["campaign"]]), snap_ids("sent_emails", [X["sent_email"]])]


def _attack(ctx: Ctx, section: str, api: Api, name: str, method: str, path: str, body: Any = None,
            snaps: Optional[Callable[[], List[Snap]]] = None, expected: set = NOT_FOUNDISH,
            markers_side: str = "xw", collision: bool = False,
            json_check: Optional[Callable[[Any], Optional[str]]] = None, scrub: Sequence[str] = ()) -> Resp:
    """Run one attack; the DB must be unchanged and the response free of the
    victim brand's markers. collision=True: the call legitimately acts on the
    attacker's OWN same-named object, so only side effects on the victim count."""
    rep = ctx.report
    w = Watch(snaps() if snaps else [])
    with w:
        r = api.call(method, path, json_body=body)
    # scrub what we sent (ids/keys/emails echoed back in error messages), not plain words
    sent = [seg for seg in path.split("/") if re.search(r"[0-9_@.-]", seg)]
    found = scan(r.text, ctx.markers(markers_side), [*sent, *scrub])
    jproblem = json_check(r.json()) if json_check else None
    what = f"{method} {path} [{api.name}: {name}]"
    if w.diffs:
        rep.add(section, "LEAK", what, user=api.name, status=r.status, diffs=w.diffs,
                detail=("victim rows restored" if not w.restore_error else f"RESTORE FAILED: {w.restore_error}"))
    elif found:
        rep.add(section, "LEAK", what, user=api.name, status=r.status, markers=found)
    elif jproblem:
        rep.add(section, "LEAK", what, user=api.name, status=r.status, detail=jproblem)
    elif collision:
        v = "ERROR" if (r.status is None or r.status >= 500) else "PASS"
        rep.add(section, v, what, user=api.name, status=r.status,
                detail="own same-key object acted on; other brand untouched" if v == "PASS" else r.short())
    else:
        v = _status_verdict(r, expected)
        rep.add(section, v, what, user=api.name, status=r.status, expected=sorted(expected),
                detail="" if v == "PASS" else r.short())
    return r


def check_byid(ctx: Ctx) -> None:
    api = ctx.s["acme_admin"]
    sec = "byid"
    seg_b1 = lambda: [Snap("segments", "brand_id = %s AND key = ANY(%s)", [B1, [cfg.XW_SEG_ONLY, cfg.SHARED_SEG]])]
    leads_b1 = lambda: [snap_ids("scraped_leads", [X["lead"], X["lead2"], X["lead3"]])]
    excl_b1 = lambda: [Snap("email_exclusions", "brand_id = %s", [B1])]
    replies_b1 = lambda: [snap_ids("sent_emails", [X["sent_email"]]),
                          Snap("email_replies", "sent_email_id::text = %s", [X["sent_email"]])]
    # real brand-1 rows are only ever sent NO-OP values (their current status), so even a
    # successful leak cannot change them; the leak is detected from the response / diff.
    real_c = (ctx.info.get("brand1_campaigns") or [{}])[0].get("id")
    real_a = (ctx.info.get("brand1_account_ids") or [None])[0]
    real_c_status = (q("SELECT status FROM campaigns WHERE id = %s", [real_c]) or [{}])[0].get("status") if real_c else None
    real_a_status = (q("SELECT status FROM email_accounts WHERE id = %s", [real_a]) or [{}])[0].get("status") if real_a else None
    T = []  # (name, method, path, body, snaps, kwargs)
    T += [
        ("campaign detail", "GET", f"/api/campaigns/detail/{X['campaign']}", None, None, {}),
        ("campaign set-status", "POST", f"/api/campaigns/{X['campaign']}/set-status", {"status": "active"}, _snaps_campaign, {}),
        ("campaign update-followups", "POST", f"/api/campaigns/{X['campaign']}/update-followups",
         {"followups": [{"after_days": 1, "subject": "pwn", "body": "pwn"}], "followup_engaged_only": True,
          "account_manager": "pwned"}, _snaps_campaign, {}),
        ("campaign remove", "DELETE", f"/api/campaigns/remove/{X['campaign']}", None, _snaps_campaign, {}),
    ]
    if real_c:
        T += [
            ("REAL brand-1 campaign detail", "GET", f"/api/campaigns/detail/{real_c}", None, None, {}),
            ("REAL brand-1 campaign set-status (no-op value)", "POST", f"/api/campaigns/{real_c}/set-status",
             {"status": real_c_status or "paused"}, lambda: [snap_ids("campaigns", [real_c])], {}),
        ]
    T += [
        ("lead detail (sent_emails id)", "GET", f"/api/leads/{X['sent_email']}", None, None, {}),
        ("lead detail (scraped_leads id)", "GET", f"/api/leads/{X['lead']}", None, None, {}),
        ("lead status", "PUT", f"/api/leads/{X['sent_email']}/status", {"status": "qualified"},
         lambda: [snap_ids("sent_emails", [X["sent_email"]]), *leads_b1()], {}),
        ("lead note", "POST", f"/api/leads/{X['lead']}/note", {"note": "pwned"}, leads_b1, {}),
        ("lead delete", "DELETE", f"/api/leads/{X['lead']}", None, leads_b1, {}),
        ("lead bulk-delete", "POST", "/api/leads/bulk-delete", [X["lead2"], X["lead3"]], leads_b1,
         {"expected": {200, 400, 403, 404}}),
        ("lead delete by-email", "DELETE", f"/api/leads/by-email/{X['lead_email']}", None, leads_b1, {}),
        ("sent email mark-replied", "PATCH", f"/api/leads/sent-emails/{X['sent_email']}/mark-replied", None, replies_b1, {}),
        ("sent email detail", "GET", f"/api/emails/sent/{X['sent_email']}", None, None, {}),
        ("reply detail", "GET", f"/api/emails/replies/{X['reply']}", None, None, {}),
        ("reply status", "PUT", f"/api/emails/replies/{X['reply']}/status", {"is_reviewed": True},
         lambda: [snap_ids("email_replies", [X["reply"]])], {}),
        ("segment update", "PATCH", f"/api/segments/{cfg.XW_SEG_ONLY}", {"label": "pwned"}, seg_b1, {}),
        ("segment delete", "DELETE", f"/api/segments/{cfg.XW_SEG_ONLY}", None,
         lambda: [*seg_b1(), *leads_b1()], {}),
        ("segment alert preview", "GET", f"/api/segments/{cfg.XW_SEG_ONLY}/alert", None, None, {}),
        ("assign brand-1 leads into acme segment", "POST", f"/api/segments/{cfg.ACME_SEG}/assign",
         {"lead_ids": [X["lead"], X["lead3"]]}, leads_b1, {"expected": {200, 400, 403, 404}}),
        ("exclusion delete", "DELETE", f"/api/exclusions/{X['exclusion']}", None, excl_b1, {}),
        ("email account detail", "GET", f"/api/email-accounts/{X['email_account']}", None, None, {}),
        ("email account status", "PUT", f"/api/email-accounts/{X['email_account']}/status", {"status": "blocked"},
         lambda: [snap_ids("email_accounts", [X["email_account"]])], {}),
        ("email account disconnect", "DELETE", f"/api/email-accounts/google/{X['email_account']}", None,
         lambda: [snap_ids("email_accounts", [X["email_account"]])], {}),
    ]
    if real_a:
        T += [("REAL brand-1 mailbox detail", "GET", f"/api/email-accounts/{real_a}", None, None, {}),
              ("REAL brand-1 mailbox status (no-op value)", "PUT", f"/api/email-accounts/{real_a}/status",
               {"status": real_a_status or "active"}, lambda: [snap_ids("email_accounts", [real_a])], {})]
    T += [
        ("api key update", "PUT", f"/api/api-keys/{X['api_key']}", {"key_name": "pwned key"},
         lambda: [snap_ids("api_keys", [X["api_key"]])], {}),
        ("api key delete", "DELETE", f"/api/api-keys/{X['api_key']}", None, lambda: [snap_ids("api_keys", [X["api_key"]])], {}),
        ("stakeholder detail", "GET", f"/api/v1/stakeholders/{X['stakeholder']}", None, None, {}),
        ("stakeholder update", "PATCH", f"/api/v1/stakeholders/{X['stakeholder']}", {"organization_name": "pwned"},
         lambda: [snap_ids("stakeholders", [X["stakeholder"]])], {}),
        ("approval resolve", "PATCH", f"/api/v1/agents/approvals/{X['approval']}",
         {"status": "APPROVED", "reviewer_email": "pwn@x.y"},
         lambda: [snap_ids("agent_execution_approvals", [X["approval"]], key="approval_id")], {}),
        ("social post update", "PATCH", f"/api/social-media/posts/{X['post']}", {"content": "pwned"},
         lambda: [snap_ids("social_media_posts", [X["post"]])], {}),
        ("social post delete", "DELETE", f"/api/social-media/posts/{X['post']}", None,
         lambda: [snap_ids("social_media_posts", [X["post"]])], {}),
        ("scheduler history delete", "DELETE", f"/api/scheduler/history/{X['run']}", None,
         lambda: [snap_ids("scheduler_run_history", [X["run"]])], {}),
        ("scraper job detail", "GET", f"/api/scraper/jobs/{X['job']}", None, None, {}),
        ("scraper job results", "GET", f"/api/scraper/jobs/{X['job']}/results", None, None, {}),
        ("scraper job download", "GET", f"/api/scraper/jobs/{X['job']}/download", None, None, {}),
    ]
    for name, method, path, body, snaps, kw in T:
        _attack(ctx, sec, api, name, method, path, body, snaps, **kw)

    # exclusion check must not reveal brand-1's list
    _attack(ctx, sec, api, "exclusion check of a brand-1 excluded address", "GET",
            f"/api/exclusions/check/{X['excluded_email']}", expected={200, 404},
            json_check=lambda j: "brand-1 exclusion visible (is_excluded=true)"
            if isinstance(j, dict) and j.get("is_excluded") else None)

    # ---- same-key collisions: acting on acme's OWN object must not touch brand 1's
    sb1 = lambda: [Snap("segments", "brand_id = %s AND key = %s", [B1, cfg.SHARED_SEG]), *leads_b1()]
    _attack(ctx, sec, api, "update own segment whose key also exists in brand 1", "PATCH",
            f"/api/segments/{cfg.SHARED_SEG}", {"label": f"{cfg.ACME_TEXT} relabel"}, sb1, collision=True)
    _attack(ctx, sec, api, "delete own segment whose key also exists in brand 1 (un-tags leads)", "DELETE",
            f"/api/segments/{cfg.SHARED_SEG}", None, sb1, collision=True)
    _attack(ctx, sec, api, "delete own exclusion of an address brand 1 also excludes", "DELETE",
            f"/api/exclusions/{A['exclusion_shared']}", None,
            lambda: [Snap("email_exclusions", "brand_id = %s AND email = %s", [B1, cfg.SHARED_EMAIL])], collision=True)
    _attack(ctx, sec, api, "disconnect own linkedin (brand 1 also has linkedin)", "DELETE",
            "/api/social-accounts/linkedin/disconnect", None,
            lambda: [Snap("social_media_accounts", "brand_id = %s", [B1])], collision=True)
    _attack(ctx, sec, api, "save own linkedin credentials (brand 1 also has linkedin)", "PUT",
            "/api/social-accounts/linkedin", {"credentials": {"note": cfg.ACME_TEXT}, "handle": f"{cfg.ACME_TEXT}_h2"},
            lambda: [Snap("social_media_accounts", "brand_id = %s", [B1])], collision=True)
    _attack(ctx, sec, api, "clear own scheduler history", "DELETE", "/api/scheduler/history", None,
            lambda: [Snap("scheduler_run_history", "brand_id = %s", [B1])], collision=True)
    _attack(ctx, sec, api, "update own AI settings", "PUT", "/api/email-ai-settings",
            {"company_tagline": f"{cfg.ACME_TEXT} tagline 2"},
            lambda: [Snap("email_ai_settings", "brand_id = %s", [B1])], collision=True)
    _attack(ctx, sec, api, "reset own AI settings", "POST", "/api/email-ai-settings/reset", None,
            lambda: [Snap("email_ai_settings", "brand_id = %s", [B1])], collision=True)
    _attack(ctx, sec, api, "update own scheduler settings", "PUT", "/api/scheduler/settings",
            {"daily_limit": 2, "send_minute": 8},
            lambda: [Snap("scheduler_settings", "brand_id = %s", [B1])], collision=True)
    _attack(ctx, sec, api, "create own segment with a key brand 1 uses", "POST", "/api/segments",
            {"label": f"{cfg.PROBE_TEXT} seg", "key": cfg.XW_SEG_ONLY},
            lambda: [Snap("segments", "brand_id = %s AND key = %s", [B1, cfg.XW_SEG_ONLY])], collision=True)
    ctx.reseed()  # restore acme's own rows the collision calls changed
    _fail_if(ctx.report, sec)


# =====================================================================
# membership / account attacks
# =====================================================================

def check_members(ctx: Ctx) -> None:
    sec = "members"
    rep = ctx.report
    api = ctx.s["acme_admin"]
    users = ctx.info["users"]
    viewer, legacy, xw_admin = users["xw_viewer"], users["xw_legacy"], users["xw_admin"]
    acct = lambda uid: [Snap("sales_reps", "id = %s", [uid], exclude=("last_login",)),
                        Snap("brand_members", "sales_rep_id = %s AND brand_id = %s", [uid, B1],
                             key="brand_id::text || ':' || sales_rep_id::text")]
    try:
        _attack(ctx, sec, api, "list members must not show brand-1 people", "GET", "/api/brands/current/members",
                expected={200})
        _attack(ctx, sec, api, "change a brand-1 member's role", "PATCH",
                f"/api/brands/current/members/{xw_admin}", {"role": "viewer"}, lambda: acct(xw_admin))
        _attack(ctx, sec, api, "remove a brand-1 member", "DELETE", f"/api/brands/current/members/{xw_admin}",
                None, lambda: acct(xw_admin))
        _attack(ctx, sec, api, "reset a brand-1 member's password", "POST",
                f"/api/brands/current/members/{viewer}/reset-password", {"new_password": "Pwned-123456"},
                lambda: acct(viewer))
        _attack(ctx, sec, api, "legacy: reset a brand-1 user's password", "POST",
                f"/api/auth/users/{viewer}/reset-password", {"new_password": "Pwned-123456"}, lambda: acct(viewer))
        _attack(ctx, sec, api, "legacy: deactivate / rename a brand-1 user", "PATCH", f"/api/auth/users/{viewer}",
                {"is_active": False, "full_name": "Pwned Name"}, lambda: acct(viewer))
        _attack(ctx, sec, api, "legacy: delete a brand-1 user", "DELETE", f"/api/auth/users/{viewer}", None,
                lambda: acct(viewer))
        # "add" an existing brand-1 account to acme WITH a password: must not change it
        r = _attack(ctx, sec, api, "add existing brand-1 account to acme with a new password", "POST",
                    "/api/brands/current/members",
                    {"email": cfg.USERS["xw_viewer"]["email"], "password": "Pwned-123456", "role": "admin"},
                    lambda: acct(viewer), expected={200, 201, 400, 403, 409}, scrub=[cfg.USERS["xw_viewer"]["email"]])
        if r.ok:
            rep.add(sec, "INFO", "an acme admin can add an existing brand-1 account to acme without its consent",
                    detail="design decision - consider an invite/accept flow")
            # now a member of both: the acme admin must still not be able to touch the account
            _attack(ctx, sec, api, "reset password of a shared member (also in brand 1)", "POST",
                    f"/api/brands/current/members/{viewer}/reset-password", {"new_password": "Pwned-123456"},
                    lambda: acct(viewer), expected={403})
            _attack(ctx, sec, api, "rename a shared member (global identity) via legacy PATCH", "PATCH",
                    f"/api/auth/users/{viewer}", {"full_name": "Pwned Name"},
                    lambda: [Snap("sales_reps", "id = %s", [viewer], exclude=("last_login",))],
                    expected={200, 400, 403})
            _attack(ctx, sec, api, "deactivate a shared member", "PATCH", f"/api/auth/users/{viewer}",
                    {"is_active": False}, lambda: acct(viewer), expected={403})
        # legacy profile with NO password that belongs to brand 1: claiming it = account takeover
        w = Watch([Snap("sales_reps", "id = %s", [legacy], exclude=("last_login",))])
        with w:
            r = api.call("POST", "/api/brands/current/members",
                         json_body={"email": cfg.LEGACY_USER["email"], "password": "Claimed-123456", "role": "viewer"})
            took, _ = login(cfg.LEGACY_USER["email"], "Claimed-123456")
        if w.diffs or took.ok:
            rep.add(sec, "LEAK", "acme admin claimed a password-less brand-1 account by adding it with a password "
                    "(account takeover into brand 1)", status=r.status, diffs=w.diffs,
                    detail=f"login with the new password -> {took.status}; password reset back")
        else:
            rep.add(sec, "PASS", "cannot claim a password-less brand-1 account", status=r.status)
        # brand-level settings of another brand
        _attack(ctx, sec, api, "edit brand 1 (platform-only route)", "PATCH", f"/api/brands/{B1}",
                {"display_name": "pwned"}, lambda: [Snap("brands", "id = %s", [B1])], expected={403})
        _attack(ctx, sec, api, "claim hostnames for own brand (platform-only)", "PATCH", "/api/brands/current",
                {"hostnames": ["mb-iso-hijack.test"]},
                lambda: [Snap("brands", "id = %s", [ctx.acme_id], exclude=("updated_at",))], expected={403})
        _attack(ctx, sec, api, "list all brands (platform-only)", "GET", "/api/brands", expected={403})
        _attack(ctx, sec, api, "create a brand (platform-only)", "POST", "/api/brands",
                {"slug": cfg.PROBE_BRAND_SLUG, "display_name": cfg.PROBE_TEXT},
                lambda: [Snap("brands", "slug = %s", [cfg.PROBE_BRAND_SLUG])], expected={403})
        # membership is re-checked on every request
        with owner_conn() as conn:
            conn.execute("DELETE FROM brand_members WHERE sales_rep_id = %s", [users["acme_admin"]])
            conn.commit()
        try:
            r = api.call("GET", "/api/campaigns/list")
            v = "PASS" if r.status in DENIED else ("LEAK" if scan(r.text, ctx.markers("acme")) else "FAIL")
            rep.add(sec, v, "token of a user removed from the brand is refused on the next request",
                    status=r.status, detail="" if v == "PASS" else r.short())
        finally:
            ctx.reseed()  # restores memberships + passwords
    finally:
        ctx.reseed()
    _fail_if(rep, sec)


# =====================================================================
# RBAC
# =====================================================================

def check_rbac(ctx: Ctx) -> None:
    sec = "rbac"
    v = ctx.s["xw_viewer"]
    P = cfg.PROBE_TEXT
    probes = [
        ("create campaign", "POST", "/api/campaigns/create", {"name": f"{P} viewer campaign", "status": "draft"},
         lambda: [Snap("campaigns", "name LIKE %s", [f"%{P}%"])]),
        ("set campaign status", "POST", f"/api/campaigns/{X['campaign']}/set-status", {"status": "active"},
         _snaps_campaign),
        ("delete campaign", "DELETE", f"/api/campaigns/remove/{X['campaign']}", None, _snaps_campaign),
        ("create segment", "POST", "/api/segments", {"label": f"{P} viewer seg", "key": "mb_iso_probe_viewer"},
         lambda: [Snap("segments", "key LIKE %s", ["mb_iso_probe%"])]),
        ("update segment", "PATCH", f"/api/segments/{cfg.XW_SEG_ONLY}", {"label": "pwned"},
         lambda: [Snap("segments", "brand_id = %s AND key = %s", [B1, cfg.XW_SEG_ONLY])]),
        ("delete segment", "DELETE", f"/api/segments/{cfg.XW_SEG_ONLY}", None,
         lambda: [Snap("segments", "brand_id = %s AND key = %s", [B1, cfg.XW_SEG_ONLY]),
                  snap_ids("scraped_leads", [X["lead3"]])]),
        ("add exclusion", "POST", "/api/exclusions/", {"email": f"viewer@{cfg.PROBE_DOMAIN}"},
         lambda: [Snap("email_exclusions", "email LIKE %s", [f"%@{cfg.PROBE_DOMAIN}"])]),
        ("delete exclusion", "DELETE", f"/api/exclusions/{X['exclusion']}", None,
         lambda: [snap_ids("email_exclusions", [X["exclusion"]])]),
        ("delete lead", "DELETE", f"/api/leads/{X['lead']}", None, lambda: [snap_ids("scraped_leads", [X["lead"]])]),
        ("bulk delete leads", "POST", "/api/leads/bulk-delete", [X["lead2"]],
         lambda: [snap_ids("scraped_leads", [X["lead2"]])]),
        ("mailbox status", "PUT", f"/api/email-accounts/{X['email_account']}/status", {"status": "blocked"},
         lambda: [snap_ids("email_accounts", [X["email_account"]])]),
        ("disconnect mailbox", "DELETE", f"/api/email-accounts/google/{X['email_account']}", None,
         lambda: [snap_ids("email_accounts", [X["email_account"]])]),
        ("create api key", "POST", "/api/api-keys/", {"key_name": f"{P} viewer key", "api_key": "x" * 12},
         lambda: [Snap("api_keys", "key_name LIKE %s", [f"%{P}%"])]),
        ("delete api key", "DELETE", f"/api/api-keys/{X['api_key']}", None, lambda: [snap_ids("api_keys", [X["api_key"]])]),
        ("update AI settings", "PUT", "/api/email-ai-settings", {"company_tagline": P},
         lambda: [Snap("email_ai_settings", "brand_id = %s", [B1])]),
        ("update scheduler settings", "PUT", "/api/scheduler/settings", {"daily_limit": 1},
         lambda: [Snap("scheduler_settings", "brand_id = %s", [B1])]),
        ("delete scheduler history row", "DELETE", f"/api/scheduler/history/{X['run']}", None,
         lambda: [snap_ids("scheduler_run_history", [X["run"]])]),
        ("create stakeholder", "POST", "/api/v1/stakeholders", {"email_address": f"viewer@{cfg.PROBE_DOMAIN}"},
         lambda: [Snap("stakeholders", "email_address LIKE %s", [f"%@{cfg.PROBE_DOMAIN}"])]),
        ("edit social post", "PATCH", f"/api/social-media/posts/{X['post']}", {"content": "pwned"},
         lambda: [snap_ids("social_media_posts", [X["post"]])]),
        ("delete social post", "DELETE", f"/api/social-media/posts/{X['post']}", None,
         lambda: [snap_ids("social_media_posts", [X["post"]])]),
        ("save social credentials", "PUT", "/api/social-accounts/linkedin", {"credentials": {"k": "v"}, "handle": "pwn"},
         lambda: [Snap("social_media_accounts", "brand_id = %s", [B1])]),
        ("add brand member", "POST", "/api/brands/current/members",
         {"email": f"probe@{cfg.PROBE_DOMAIN}", "role": "admin", "password": "Probe-123456"},
         lambda: [Snap("brand_members", "brand_id = %s", [B1], key="brand_id::text || ':' || sales_rep_id::text")]),
        ("edit brand", "PATCH", "/api/brands/current", {"display_name": "pwned"},
         lambda: [Snap("brands", "id = %s", [B1])]),
        ("list members (users.view)", "GET", "/api/brands/current/members", None, None),
        ("list all brands (platform)", "GET", "/api/brands", None, None),
        ("create brand (platform)", "POST", "/api/brands", {"slug": cfg.PROBE_BRAND_SLUG, "display_name": P},
         lambda: [Snap("brands", "slug = %s", [cfg.PROBE_BRAND_SLUG])]),
    ]
    rep = ctx.report
    for name, method, path, body, snaps in probes:
        w = Watch(snaps() if snaps else [])
        with w:
            r = v.call(method, path, json_body=body)
        what = f"{method} {path} [xw_viewer: {name}]"
        if w.diffs:
            rep.add(sec, "FAIL", what, user="xw_viewer", status=r.status, diffs=w.diffs,
                    detail="viewer changed data (rows restored)")
        elif r.status == 403:
            rep.add(sec, "PASS", what, user="xw_viewer", status=r.status)
        elif r.ok:
            rep.add(sec, "FAIL", what, user="xw_viewer", status=r.status, detail=f"expected 403: {r.short()}")
        else:
            rep.add(sec, _status_verdict(r, {403}), what, user="xw_viewer", status=r.status,
                    detail=f"expected 403: {r.short()}")
    # brand admins that are not platform admins
    a = ctx.s["xw_admin"]
    for name, method, path, body, snaps in (
        ("list all brands", "GET", "/api/brands", None, None),
        ("create brand", "POST", "/api/brands", {"slug": cfg.PROBE_BRAND_SLUG, "display_name": P},
         lambda: [Snap("brands", "slug = %s", [cfg.PROBE_BRAND_SLUG])]),
        ("edit acme", "PATCH", f"/api/brands/{ctx.acme_id}", {"display_name": "pwned"},
         lambda: [Snap("brands", "id = %s", [ctx.acme_id])]),
    ):
        w = Watch(snaps() if snaps else [])
        with w:
            r = a.call(method, path, json_body=body)
        what = f"{method} {path} [xw_admin (not platform): {name}]"
        verdict = "FAIL" if (w.diffs or r.ok) else ("PASS" if r.status == 403 else _status_verdict(r, {403}))
        rep.add(sec, verdict, what, user="xw_admin", status=r.status, diffs=w.diffs,
                detail="" if verdict == "PASS" else r.short())
        if verdict == "FAIL" and r.ok and method == "GET":
            found = scan(r.text, ctx.markers("acme"))
            if found:
                rep.add(sec, "LEAK", f"{what} shows acme", markers=found)
    ctx.reseed()
    _fail_if(rep, sec)


# =====================================================================
# brand switching / tokens / hosts
# =====================================================================

def _unsigned_jwt(claims: dict) -> str:
    import base64
    import json as _json

    def b64(d: dict) -> str:
        return base64.urlsafe_b64encode(_json.dumps(d).encode()).rstrip(b"=").decode()
    return f"{b64({'alg': 'none', 'typ': 'JWT'})}.{b64(claims)}."


LIST_PROBES = ["/api/campaigns/list", "/api/segments", "/api/exclusions/", "/api/email-accounts/",
               "/api/email-accounts/personas", "/api/emails/sent", "/api/emails/replies", "/api/email-ai-settings",
               "/api/social-accounts/", "/api/api-keys/", "/api/v1/stakeholders", "/api/scheduler/history",
               "/api/scraper/jobs", "/api/auth/me", "/api/brands/current"]


def _brand_of(api: Api, headers: Optional[dict] = None) -> tuple:
    r = api.call("GET", "/api/auth/me", headers=headers)
    return r, ((r.json() or {}).get("brand_id") if r.ok else None)


def _view_check(ctx: Ctx, sec: str, api: Api, label: str, own_side: str, headers: Optional[dict] = None) -> None:
    """In brand `own_side`, the list endpoints show own data and never the other side's."""
    rep = ctx.report
    other = "xw" if own_side == "acme" else "acme"
    own_seen = False
    for path in LIST_PROBES:
        r = api.call("GET", path, headers=headers)
        found = scan(r.text, ctx.markers(other, with_brand_id=False))
        if found:
            rep.add(sec, "LEAK", f"GET {path} [{label}]", status=r.status, markers=found)
        if r.ok and scan(r.text, cfg.base_markers(own_side)):
            own_seen = True
    rep.add(sec, "PASS" if own_seen else "FAIL", f"{label}: own-brand data visible in list endpoints",
            detail="" if own_seen else "no own-brand marker found in any list endpoint")


def check_switch(ctx: Ctx) -> None:
    sec = "switch"
    rep = ctx.report
    acme, ad, xa, pa = ctx.acme_id, ctx.s["acme_admin"], ctx.s["xw_admin"], ctx.s["plat_admin"]

    for target in (B1, cfg.BRAND1_SLUG):
        r = ad.call("POST", "/api/brands/switch", json_body={"brand_id": target})
        token = (r.json() or {}).get("access_token") if r.ok else None
        rep.add(sec, "PASS" if r.status in (403, 404) and not token else "FAIL",
                f"acme_admin switch to brand 1 ({target}) refused", status=r.status, detail=r.short())
    r = xa.call("POST", "/api/brands/switch", json_body={"brand_id": acme})
    rep.add(sec, "PASS" if r.status in (403, 404) else "FAIL", "xw_admin switch to acme refused",
            status=r.status, detail=r.short())

    for brand in (B1, cfg.BRAND1_SLUG):
        lr, data = login(cfg.USERS["acme_admin"]["email"], cfg.PASSWORD, brand=brand)
        got = ((data or {}).get("user") or {}).get("brand_id")
        rep.add(sec, "PASS" if (got == acme or lr.status in DENIED) else "FAIL",
                f"acme_admin login asking for brand {brand} does not land in brand 1",
                status=lr.status, detail=f"brand_id={got}")

    spoof = {"X-Brand-Id": B1, "X-Brand": cfg.BRAND1_SLUG, "X-Tenant-Id": B1, "X-Brand-Slug": cfg.BRAND1_SLUG}
    r, got = _brand_of(ad, spoof)
    rep.add(sec, "PASS" if got == acme else "FAIL", "spoofed X-Brand* headers ignored", status=r.status,
            detail=f"brand_id={got}")
    _view_check(ctx, sec, ad, "acme_admin + spoofed brand headers", "acme", headers=spoof)

    # Host pinning (brands.hostnames): the Host header decides; X-Forwarded-Host is ignored
    hdr = {"Host": cfg.ACME_HOST}
    r, got = _brand_of(xa, hdr)
    rep.add(sec, "PASS" if r.status == 403 else ("LEAK" if got == acme else "FAIL"),
            "xw_admin on acme's dedicated host is refused", status=r.status, detail=f"brand_id={got}")
    r, got = _brand_of(ad, hdr)
    rep.add(sec, "PASS" if got == acme else "FAIL", "acme_admin on acme's host works",
            status=r.status, detail=f"brand_id={got}")
    r, got = _brand_of(pa, hdr)
    rep.add(sec, "PASS" if got == acme else "FAIL", "plat_admin on acme's host acts in acme",
            status=r.status, detail=f"brand_id={got}")
    r, got = _brand_of(xa, {"X-Forwarded-Host": cfg.ACME_HOST})
    rep.add(sec, "PASS" if got == B1 else ("LEAK" if got == acme else "FAIL"),
            "spoofed X-Forwarded-Host does not change xw_admin's brand", status=r.status, detail=f"brand_id={got}")
    r, got = _brand_of(ad, {"Host": "127.0.0.1", "X-Forwarded-Host": "brand1-spoof.test"})
    rep.add(sec, "PASS" if got == acme else "FAIL", "acme_admin on the shared host stays in acme",
            status=r.status, detail=f"brand_id={got}")

    # platform admin: sees both brands, each only in its own context
    r = pa.call("GET", "/api/brands")
    slugs = {b.get("slug") for b in ((r.json() or {}).get("brands") or [])} if r.ok else set()
    rep.add(sec, "PASS" if {cfg.ACME_SLUG, cfg.BRAND1_SLUG} <= slugs else "FAIL",
            "plat_admin GET /api/brands lists acme and brand 1", status=r.status, detail=str(sorted(slugs))[:200])
    for target, side in ((acme, "acme"), (B1, "xw")):
        r = pa.call("POST", "/api/brands/switch", json_body={"brand_id": target})
        token = (r.json() or {}).get("access_token") if r.ok else None
        if not token:
            rep.add(sec, "FAIL", f"plat_admin switch to {side}", status=r.status, detail=r.short())
            continue
        sw = Api(f"plat_admin@{side}", token)
        try:
            r2, got = _brand_of(sw)
            rep.add(sec, "PASS" if got == target else "FAIL", f"plat_admin switched token acts in {side}",
                    status=r2.status, detail=f"brand_id={got}")
            _view_check(ctx, sec, sw, f"plat_admin in {side}", side)
        finally:
            sw.close()

    # tokens
    try:
        import jwt as pyjwt
        now = int(time.time())
        claims = {"sub": ctx.info["users"]["acme_admin"], "email": cfg.USERS["acme_admin"]["email"],
                  "role": "admin", "brand": B1, "exp": now + 600}
        for label, tok in (("signed with a wrong secret", pyjwt.encode(claims, "wrong-secret-" + "x" * 40, algorithm="HS256")),
                           ("alg=none", _unsigned_jwt(claims))):
            t = Api(f"forged:{label}", tok)
            r = t.call("GET", "/api/campaigns/list")
            t.close()
            rep.add(sec, "PASS" if r.status == 401 else "FAIL", f"forged token ({label}) rejected", status=r.status)
        if cfg.JWT_SECRET:
            tok = pyjwt.encode(claims, cfg.JWT_SECRET, algorithm="HS256")
            t = Api("acme_admin(brand claim=1)", tok)
            r, got = _brand_of(t)
            if r.status == 401:
                rep.add(sec, "SKIP", "validly signed token with brand claim = brand 1",
                        detail="MB_JWT_SECRET does not match the server")
            else:
                rep.add(sec, "PASS" if got == acme or r.status == 403 else "FAIL",
                        "acme_admin token claiming brand 1 falls back to acme / is refused",
                        status=r.status, detail=f"brand_id={got}")
                if r.ok:
                    _view_check(ctx, sec, t, "acme_admin token with brand-1 claim", "acme")
            t.close()
        else:
            rep.add(sec, "SKIP", "validly signed token with brand claim = brand 1",
                    detail="set MB_JWT_SECRET to the server's JWT secret to enable")
    except ImportError as e:
        rep.add(sec, "SKIP", "forged-token tests", detail=f"pyjwt missing: {e}")
    _fail_if(rep, sec)


# =====================================================================
# secrets: OAuth tokens never returned; the AI key unmasked only for admins
# =====================================================================

_TOKEN_KEY_RE = re.compile(r"(refresh_token|access_token)$", re.I)


def _token_fields(obj: Any, path: str = "") -> List[str]:
    """JSON paths of non-empty *refresh_token / *access_token fields."""
    out: List[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{path}.{k}" if path else str(k)
            if _TOKEN_KEY_RE.search(str(k)) and v not in (None, "", False):
                out.append(p)
            out += _token_fields(v, p)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out += _token_fields(v, f"{path}[{i}]")
    return out


def _role_of(user: str) -> str:
    spec = cfg.USERS[user]
    return spec["memberships"][0][1] if spec["memberships"] else "-"


def check_secrets(ctx: Ctx) -> None:
    """Every brand role, in acme (admin/manager/member/viewer) and brand 1
    (admin/viewer):
      * GET /api/email-accounts/ (+ the planted mailbox's detail) never carries
        a refresh_token / access_token value - fake tokens are planted on acme's
        fixture mailbox and on the inactive brand-1 victim for the duration of
        the check; brand 1's real stored tokens are checked too (read-only).
      * GET /api/email-ai-settings returns the stored ai_api_key unmasked to
        admins only - a fake key is planted in acme's settings for the check;
        brand 1's real key (if any) is compared read-only.
    Secret values are never written to the report (only labels / lengths)."""
    sec = "secrets"
    rep = ctx.report
    acme = ctx.acme_id
    acme_users = [u for u, s in cfg.USERS.items() if s["memberships"] and s["memberships"][0][0] == "acme"]
    xw_users = [u for u, s in cfg.USERS.items() if s["memberships"] and s["memberships"][0][0] == "brand1"]

    # ---- known token values: label -> (side, value). Real ones are read, never printed.
    tokens: Dict[str, tuple] = {}
    for side in ("acme", "xw"):
        for col, val in cfg.FAKE_TOKENS[side].items():
            tokens[f"planted {side} {col}"] = (side, val)
    real = q("SELECT refresh_token, access_token FROM email_accounts WHERE brand_id = %s AND NOT (id::text = ANY(%s))",
             [B1, [X["email_account"]]])
    for i, row in enumerate(real):
        for col in ("refresh_token", "access_token"):
            v = row.get(col)
            if v and len(str(v)) >= 12:
                tokens[f"real brand-1 {col} #{i + 1}"] = ("xw", str(v))
    if not any(lbl.startswith("real") for lbl in tokens):
        rep.add(sec, "INFO", "brand 1 has no stored OAuth tokens - only the planted ones are checked")

    def token_probe(user: str, side: str, own_account: str) -> None:
        api = ctx.s[user]
        role = _role_of(user)
        for path, must_list in (("/api/email-accounts/", True), (f"/api/email-accounts/{own_account}", False)):
            r = api.call("GET", path)
            what = f"GET {path} [{user} ({role})]: no OAuth token values"
            if not r.ok:
                rep.add(sec, "ERROR", what, user=user, status=r.status,
                        detail="could not verify (non-2xx; body not shown, it may hold secrets)")
                continue
            low = r.text.lower()
            fields = _token_fields(r.json())
            own_vals = sorted(lbl for lbl, (s, v) in tokens.items() if s == side and v.lower() in low)
            foreign_vals = sorted(lbl for lbl, (s, v) in tokens.items() if s != side and v.lower() in low)
            if foreign_vals:
                rep.add(sec, "LEAK", what, user=user, status=r.status,
                        detail=f"other brand's token value(s) in the response: {foreign_vals}")
            elif fields or own_vals:
                rep.add(sec, "FAIL", what, user=user, status=r.status,
                        detail=f"token fields {fields[:6]} / values {own_vals} returned (values not shown)")
            elif must_list and own_account.lower() not in low:
                rep.add(sec, "ERROR", what, user=user, status=r.status,
                        detail="the mailbox holding the planted tokens is not in the list - check is vacuous")
            else:
                rep.add(sec, "PASS", what, user=user, status=r.status)

    with planted("email_accounts", "id", A["email_account"], dict(cfg.FAKE_TOKENS["acme"])) as ok_a, \
            planted("email_accounts", "id", X["email_account"], dict(cfg.FAKE_TOKENS["xw"])) as ok_x:
        if not (ok_a and ok_x):
            rep.add(sec, "ERROR", "fixture mailboxes missing - could not plant tokens",
                    detail=f"acme={ok_a} brand1-victim={ok_x}")
        for user in acme_users:
            token_probe(user, "acme", A["email_account"])
        for user in xw_users:
            token_probe(user, "xw", X["email_account"])

    # ---- AI key
    def key_probe(user: str, side: str, key: str, other_keys: List[str], label: str) -> None:
        api = ctx.s[user]
        role = _role_of(user)
        r = api.call("GET", "/api/email-ai-settings")
        what = f"GET /api/email-ai-settings [{user} ({role})]: {label} ai_api_key " + \
               ("unmasked (admin)" if role == "admin" else "masked")
        if not r.ok:
            rep.add(sec, "ERROR", what, user=user, status=r.status,
                    detail="could not verify (non-2xx; body not shown, it may hold secrets)")
            return
        low = r.text.lower()
        if any(k and k.lower() in low for k in other_keys):
            rep.add(sec, "LEAK", what, user=user, status=r.status, detail="the other brand's ai_api_key is in the response")
            return
        got = (r.json() or {}).get("ai_api_key") if isinstance(r.json(), dict) else None
        full_seen = key.lower() in low
        if role == "admin":
            ok = got == key
            rep.add(sec, "PASS" if ok else "FAIL", what, user=user, status=r.status,
                    detail="" if ok else f"admin did not get the stored key (got {len(str(got or ''))} chars)")
        else:
            rep.add(sec, "FAIL" if full_seen else "PASS", what, user=user, status=r.status,
                    detail="full key returned to a non-admin (value not shown)" if full_seen
                    else f"masked ({len(str(got or ''))} chars)")

    b1_key = str((q("SELECT ai_api_key FROM email_ai_settings WHERE brand_id = %s ORDER BY id LIMIT 1", [B1])
                  or [{}])[0].get("ai_api_key") or "")
    if len(b1_key) < 8:
        b1_key = ""   # too short to search for safely (and nothing worth masking)
    with planted("email_ai_settings", "brand_id", acme, {"ai_api_key": cfg.FAKE_AI_KEY}) as ok:
        if not ok:
            rep.add(sec, "ERROR", "acme email_ai_settings row missing - could not plant an AI key")
        else:
            for user in acme_users:
                key_probe(user, "acme", cfg.FAKE_AI_KEY, [b1_key], "planted")
        if b1_key:
            for user in xw_users:
                key_probe(user, "xw", b1_key, [cfg.FAKE_AI_KEY], "brand-1 stored")
        else:
            rep.add(sec, "INFO", "brand 1 has no stored ai_api_key - masking checked in acme only")
    _fail_if(rep, sec)


ALL_CHECKS = [
    ("sanity", check_sanity), ("public", check_public), ("unauth", check_unauth), ("rls", check_rls),
    ("sweep", check_sweep), ("byid", check_byid), ("members", check_members), ("rbac", check_rbac),
    ("switch", check_switch), ("secrets", check_secrets),
]
