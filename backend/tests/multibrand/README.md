# Multi-brand isolation suite

Automated **cross-brand leak** tests for the multi-brand backend (see
[`docs/MULTIBRAND.md`](../../../docs/MULTIBRAND.md)). It runs against a **live
local backend** and its database. Use a disposable or staging database - never
production: the suite writes fixtures and deliberately attacks data.

It works on a **fresh, empty install** as well as on a populated database. The
brand-1 (default brand) slug and the brand-1 "real data" leak markers
(mailboxes, campaigns, recent recipients and leads) are read from the database
at fixture time; on an empty install those lists are simply empty and the
suite relies on its own sacrificial brand-1 victim rows.

Prerequisites: the backend has started at least once (so the multi-brand
migration created the default brand and the `app_rw` role), and `app_rw` can
log in (`APP_DB_PASSWORD` set on the backend; pass the same password in
`MB_APP_DSN`).

## Run

```bash
# from the repo root; API on :18000, Postgres on :55432 (the defaults - override with MB_*)
backend/tests/multibrand/run.sh                       # full run, summary table at the end

# the plain runner needs no pytest (the backend image does not ship pytest)
MB_RUNNER=plain backend/tests/multibrand/run.sh
MB_RUNNER=plain backend/tests/multibrand/run.sh --only sweep,byid
MB_RUNNER=plain backend/tests/multibrand/run.sh -x     # stop at the first failing check
```

`run.sh` starts a backend image (`MB_IMAGE`, default `mb-backend:base` - tag
your built backend image with that name or set `MB_IMAGE`) with
`--network host`, mounts `backend/` at `/app`, runs as your uid (so it leaves
no root-owned files), and passes every `MB_*` variable through. If pytest is
missing, it installs pytest into `/tmp` inside the container. If that fails, it
uses `run_isolation.py` instead. The equivalent manual command:

```bash
docker run --rm --network host -v $PWD/backend:/app -w /app mb-backend:base \
  sh -c 'pip install -q pytest && python -m pytest tests/multibrand -q'
```

Leave out `-x` if you want the whole picture. Each test covers one area, and the
summary table counts every individual probe.

### Environment

| var | default | meaning |
|---|---|---|
| `MB_API` | `http://127.0.0.1:18000` | backend base URL |
| `MB_OWNER_DSN` | `postgresql://marketing:marketing@127.0.0.1:55432/marketing_ai` | schema owner. Seeds fixtures, takes before/after snapshots, restores rows |
| `MB_APP_DSN` | `postgresql://app_rw:apprw_local@127.0.0.1:55432/marketing_ai` | least-privilege role, used for the RLS checks |
| `MB_STRICT` | off | `1` turns WEAK (wrong status code, but no data seen or changed) into a failure |
| `MB_KEEP_FIXTURES` | off | `1` keeps the brand-1 victim rows after the run |
| `MB_REPORT` | `tests/multibrand/reports/last_report.json` | full JSON report, one row per probe |
| `MB_JWT_SECRET` | from `backend/.env` | lets the suite mint a validly signed token that claims brand 1 (it SKIPs if this does not match the server) |
| `MB_TIMEOUT` | 60 | per-request timeout in seconds |
| `MB_BRAND_CACHE_WAIT` | 45 | how long to wait for the API's 30 s brand cache to pick up a newly created `acme` |
| `MB_BRAND1_SLUG` | `default` | fallback brand-1 slug, used only until the database is reachable (the real slug is read from `brands`) |

## What it creates (idempotent, fixed UUIDs)

* Brand **acme** (slug `acme`, dedicated hostname `acme-iso.test`, sending
  disabled) with distinctive marker rows in every major tenant table: leads,
  job and logs, segments, mailbox, campaign, sent email, reply, click, bounce,
  exclusions, unsubscribe, AI and scheduler settings, run history, social
  account and post, stakeholder and audit log, approval, API key, form
  session/response/event, and a legacy-migration batch. The markers are
  `acme-isolation.test` and `ACME_ISO_MARKER`, plus every fixture id.
* Users, all with the password `MB_TEST_PASSWORD`:
  * `acme_admin@acme-isolation.test`: acme admin
  * `xw_admin@xw-isolation.test`: brand-1 admin, not a platform admin
  * `xw_viewer@xw-isolation.test`: brand-1 viewer
  * `plat_admin@mb-isolation.test`: platform admin with no membership
  * `xw_legacy@xw-isolation.test`: brand-1 member with no password, used for the account-claim test
  * `acme_manager@`, `acme_member@`, `acme_viewer@acme-isolation.test`: one acme user per remaining role (secrets check)
* Brand-1 **victim** rows (`xw-isolation.test` / `XW_ISO_MARKER`; paused,
  inactive or archived, so nothing ever sends). The attacks target these rows,
  so a real leak cannot damage genuine brand-1 data. Brand-1 leak markers also
  include whatever real data brand 1 holds in the database under test (persona
  addresses, campaign names and ids, mailbox ids, recent recipients and leads);
  on a fresh install there is none and only the victim markers are used.
* Segment key `xw_iso_shared_seg` and address `shared@mb-iso-shared.example.com`
  exist in **both** brands, for the same-key collision attacks.

Every attack snapshots the victim rows first and compares them afterwards. If an
attack got through, the suite reports it as a LEAK and **restores** the rows.
Teardown deletes the victims, anything a failed probe created (rows, accounts,
a `mb-iso-probe` brand) and every acme tenant row, including rows the app
created on its own during the run (auto-exclusions, default social accounts,
audit rows). Brand acme and the users are kept for the next run. `seed()`
scrubs the same leftovers before it rebuilds the fixtures, so a re-run against
the same database - even after a crashed run - starts from the same state.

```bash
MB_RUNNER=plain backend/tests/multibrand/run.sh --seed          # create/refresh fixtures only
MB_RUNNER=plain backend/tests/multibrand/run.sh --cleanup       # victims + probe rows
MB_RUNNER=plain backend/tests/multibrand/run.sh --cleanup-all   # ...and brand acme + test users
```

## Checks (in order)

| test | what |
|---|---|
| sanity | Each admin lands in its own brand, sees its own fixture campaign, and the marker detector finds its own markers. If this fails, every "no leak" result is meaningless. |
| public | `GET /api/brands/public-config` without auth: the default host gives brand 1, `Host: acme-iso.test` gives acme, and a spoofed `X-Forwarded-Host` is ignored. Also checks for no cross-brand markers, and that a wrong password gives 401. `GET /api/setup/config` (public by design: pre-login branding) shows no acme data on the default host and acme's own branding, never brand 1's, on acme's host. |
| unauth | Every route in `/openapi.json` (also tries `/api/openapi.json`) is called with no token and with a garbage token, and must return 401/403. A short allow-list of public routes is skipped (including `GET /api/setup/config`, the pre-login branding; `public` checks it stays brand-correct). Mutating routes that could have side effects if they were open (send, run-now, start, sync, test, ...) are not called. Instead, their OpenAPI entry must declare the auth header. |
| rls | Every tenant table must have RLS enabled with a policy. As `app_rw`: no `app.brand_id` gives 0 rows; acme or brand 1 sees only its own rows; cross-brand UPDATE/DELETE affects 0 rows; INSERT or UPDATE into another brand fails WITH CHECK; the brand_id DEFAULT is filled in; DDL is refused; the role is not superuser and has no BYPASSRLS. Composite `(id, brand_id)` FKs reject cross-brand parents. |
| sweep | **Every GET route**, as `xw_admin` and as `acme_admin`. Path params are filled with own ids, then with the **other brand's** ids; query params (`search`, `segment`, `campaign_id`, `email`, ...) are filled with the other brand's values. The other brand's markers must never appear in the response; values we sent are scrubbed first, so echoes don't count. Anonymous calls must never show acme data. On public routes, brand-1 data seen by acme is INFO, because brand 1 is the default public brand. |
| byid | As `acme_admin`, attacks brand-1 objects by id: campaign detail, set-status, follow-ups and remove; lead detail, status, note, delete, bulk-delete and by-email; mark-replied; reply status; segment update, delete, alert and assign; exclusion delete and check; mailbox detail, status and disconnect; API keys; stakeholders; approvals; social posts; scheduler history; scraper jobs. Each must change nothing in the DB and must not show brand-1 markers. Real brand-1 campaigns and mailboxes are only ever sent no-op values. It also runs **same-key collisions**: acme acts on its own segment, exclusion, linkedin account, history and settings that share a key with brand 1, and brand 1 must be untouched. |
| members | As acme admin: change role, remove, reset password, legacy `/api/auth/users*` edit or delete a brand-1 member; add an existing brand-1 account with a new password; **claim a password-less brand-1 account** (account takeover); edit brand 1 or hostnames; list or create brands. A token whose membership was removed must be refused on the next request. |
| rbac | `xw_viewer` gets 403 on 26 create/edit/delete/admin endpoints, and the DB stays unchanged. A non-platform admin cannot list, create or edit brands. |
| switch | acme_admin cannot switch to brand 1 (by id or slug), and a login asking for brand 1 does not land there. Spoofed `X-Brand*` headers and `X-Forwarded-Host` are ignored. `Host` pins the brand: an xw user on acme's host gets 403. plat_admin sees both brands in `/api/brands` and, after switching, sees each brand's data only in that brand. Tokens with a wrong signature or `alg=none` get 401. A validly signed token that claims brand 1 for an acme user falls back to acme. |
| secrets | Every role (acme: admin, manager, member, viewer; brand 1: admin, viewer). `GET /api/email-accounts/` and the mailbox detail must carry no `refresh_token` / `access_token` value: fake tokens are planted on acme's mailbox and the brand-1 victim for the duration of the check, and brand 1's real stored tokens are searched for too. `GET /api/email-ai-settings` must return the stored `ai_api_key` unmasked to admins and masked to everyone else (a fake key is planted in acme; brand 1's real key is compared read-only). Secret values never go into the report. |

## Reading the result

The summary table counts each verdict per section:

* **LEAK**: another brand's data was visible or modified. Always a failure. Includes the
  marker, a context snippet, or the row diff.
* **FAIL**: a security expectation failed: an open route, missing RBAC, the wrong brand after a switch, or an RLS hole.
* **WEAK**: isolation held, but the status code was unexpected, e.g. `200
  {"success":true}` on a cross-brand delete that deleted nothing. A failure only with `MB_STRICT=1`.
* **ERROR**: the endpoint failed for an unrelated reason (5xx, timeout, 422). This is
  not a leak, but check it, because an endpoint that always fails proves nothing.
* **SKIP / INFO**: not exercised, with the reason; or an observation.

The JSON report (`MB_REPORT`) has one row per probe, with status, markers, diffs and URL.

Files: `mbconfig.py` (env, fixed ids, markers), `mbfixtures.py` (seed,
cleanup, discover; also a CLI), `mbdb.py` (owner/app connections,
snapshot/compare/restore), `mbapi.py` (sessions, OpenAPI, marker scan),
`mbreport.py` (verdicts, table, JSON), `isolation_checks.py` (the checks),
`test_isolation.py` + `conftest.py` (pytest), `run_isolation.py` (no-pytest runner),
`run.sh` (docker wrapper).
