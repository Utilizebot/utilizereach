# Multi-brand (multi-tenant) architecture

One UtilizeReach deployment can host many **brands** (workspaces). Each brand
has its own branding, mailboxes, personas, AI settings, leads, segments,
campaigns, sends, opt-out lists, analytics and team. Nothing one brand owns is
visible to, or changeable by, another brand.

Brand 1 is **the default brand** (slug `default`, fixed id
`00000000-0000-0000-0000-0000000000a1`). It is created by the migration, and on
an upgrade from v1.x every existing row is assigned to it. A single-brand
install simply never creates a second brand and works exactly as before.

## Concepts

* **Brand** - a row in `brands`: identity (`slug`, `display_name`,
  `website_domain`, optional dedicated `hostnames[]`), dashboard/form
  `branding`, and `sender` settings (pacing, CTA, alerts, AI identity).
* **Membership** - `brand_members(user, brand, role)`. A login (`sales_reps`)
  can belong to several brands with a **different role in each**: `admin`,
  `manager`, `member` or `viewer` (see `api/permissions.py`). One membership
  is the user's default brand.
* **Platform admin** - `sales_reps.is_platform_admin`. Can list, create and
  edit brands and switch into any brand. It does not by itself grant access to
  a brand's data outside the brand the token is switched into.
* **Brand switcher** - the brand block in the top bar. A user with more than
  one brand (or a platform admin) can switch; switching issues a new JWT for
  the target brand (`POST /api/brands/switch`).

## How isolation works (three layers)

1. **App layer (automatic for the query builder).** `database/pg.py`
   auto-scopes every `get_supabase_admin_client().table(<tenant table>)...`
   call to the active brand: reads/updates/deletes get `brand_id = <active>`
   ANDed in (a by-id lookup of another brand's row returns nothing -> 404),
   inserts/upserts are stamped with the active brand. Touching a tenant table
   with no active brand raises `TenancyError` (fail closed).
2. **Data layer.** Composite `(id, brand_id)` foreign keys: a send, click,
   reply, queue row, profile etc. can only reference a parent of its own brand.
3. **Row-level security.** Every tenant table has a fail-closed RLS policy on
   `app.brand_id`. The API, Celery and the sender connect as the non-owner role
   `app_rw`, so Postgres itself filters even raw SQL. `pg.py` binds
   `app.brand_id` inside each statement's own transaction.

Tenant tables (`database/tenancy.py: TENANT_TABLES`): scraped_leads,
scraping_jobs, scraping_logs, campaigns, sent_emails, email_queue,
email_clicks, email_replies, email_bounces, email_unsubscribes,
email_exclusions, email_accounts, segments, email_ai_settings,
scheduler_settings, scheduler_run_history, form_sessions, form_responses,
form_steps, tracking_events, api_keys, social_media_accounts,
social_media_posts, stakeholders, shareholder_profiles, partner_profiles,
govt_agency_profiles, staging_legacy_contacts, stakeholder_audit_logs,
agent_execution_approvals, (view) analytics_overview.

Global (NOT tenant) tables: `brands`, `brand_members`, `sales_reps` (login
identity), `global_suppression`, `tenancy_migrations`.

### The `app_rw` role, `APP_DB_PASSWORD` and `TENANCY_APP_ROLE`

The migration (`database/multibrand.sql`) creates `app_rw` as a `NOLOGIN`,
non-superuser, `NOBYPASSRLS` role with plain read/write grants. It cannot run
DDL, and RLS always applies to it. Migrations keep using the schema owner
(`DATABASE_URL`).

* **`APP_DB_PASSWORD`** - when set, the backend's migration step gives `app_rw`
  `LOGIN` with that password, and the API, Celery and the sender connect as
  `app_rw` (the URL is `DATABASE_URL` with the user swapped to `app_rw`).
  Set it in every container that runs app code (backend, celery worker,
  celery beat). Use a long random value.
* **`APP_DATABASE_URL`** - optional explicit DSN for the app role; overrides
  the derived one (e.g. a different host or a connection pooler).
* Neither set: the app connects as the owner. App-layer scoping and the
  composite foreign keys still isolate brands, but RLS is not a backstop.
  Fine for a single-brand install; **set `APP_DB_PASSWORD` before you add a
  second brand.**
* **`TENANCY_APP_ROLE=off`** (+ restart backend and Celery) is the emergency
  switch: the app connects as the owner again, so row-level security no longer
  applies (app-layer brand scoping still does). Use it only to recover from an
  RLS problem, then remove it.

## Where the active brand comes from

| Unit of work | How the brand is set |
|---|---|
| Authenticated API request | `api/dependencies.get_current_user` (router-level dependency): brand-dedicated Host -> that brand; else the JWT `brand` claim; else the user's default membership. Membership re-checked every request. |
| SSE endpoint (EventSource can't send headers) | `Depends(get_current_user_from_query)` - accepts `?token=<jwt>` |
| Public endpoint writing tenant data (form tracking, chat) | `Depends(public_brand_scope)` - Host-resolved brand, else the default brand. Never from the body. |
| Public token endpoints (tracking pixel/click, unsubscribe) | look the token up inside `with system_scope():` to learn its brand, then do the writes inside `with brand_scope(row["brand_id"]):` |
| Sender / cron handlers / scripts | `with brand_scope(brand_id):` for the whole run |
| Celery tasks | every task touching tenant data takes a `brand_id` kwarg and wraps its body in `with brand_scope(brand_id):`; callers enqueue with `brand_id=tenancy.require_brand()` |

Only the `Host` header pins a brand; `X-Forwarded-Host` and any `X-Brand*`
style header are ignored. A user who is not a member of a host's brand gets 403
on that host.

## Backend rules (every router / task / script MUST follow)

```python
from database import tenancy
from database.tenancy import brand_scope, system_scope, require_brand
from api.dependencies import get_current_user, require_permission, public_brand_scope
```

1. **Query builder on tenant tables needs nothing extra** inside an
   authenticated request - it is scoped automatically. Do NOT pass another
   brand's id; a mismatched `brand_id` raises.
2. **Raw SQL (`execute_sql`) on tenant tables must filter by brand explicitly**:
   add `AND brand_id = %s` (or `t.brand_id = %s` per joined tenant table) with
   `tenancy.require_brand()` as the parameter. RLS is a backstop, not the plan.
   Joins: scope EVERY tenant table in the join (or join on brand_id too).
3. **Former singletons are now one row per brand**: `email_ai_settings`,
   `scheduler_settings`. Query-builder `.limit(1)` reads are already per brand;
   raw `SELECT ... LIMIT 1` must add `WHERE brand_id = %s`. When the active
   brand has no row yet, create it (copy safe defaults), never read another
   brand's.
4. **Uniqueness is per brand** for: segments(brand_id, key),
   email_exclusions(brand_id, email), email_unsubscribes(brand_id, email),
   social_media_accounts(brand_id, platform), stakeholders(brand_id,
   email_address), email_ai_settings(brand_id), scheduler_settings(brand_id).
   Any `ON CONFLICT (key)` / `(email)` / `(platform)` / `on_conflict="key"`
   must become `(brand_id, key)` etc. Mailbox `email_accounts.email` stays
   GLOBALLY unique (a mailbox belongs to exactly one brand).
5. **No module-level caches of tenant data** (config rows, personas, AI
   settings, Gmail clients) unless keyed by brand id.
6. **No DB work at import time** (there is no brand at import). No runtime DDL
   (`CREATE TABLE`, `ALTER`) - the app role cannot do DDL; schema lives in
   `database/*.sql`.
7. **No direct `get_pool()` / psycopg connections** outside `database/pg.py`
   and `database/migrate.py` - they would skip brand binding.
8. **Threads / executors** lose the brand ContextVar: wrap targets with
   `contextvars.copy_context().run` or pass brand_id and use `brand_scope`.
9. **Cross-brand reads are only allowed** for platform-admin endpoints and
   public-token lookups, inside `system_scope()`, and must never return another
   brand's data to a brand user.
10. Brand-specific values (CTA URL, website domain, unsubscribe salt, alert
    sender, AI brief, persona copy, UTM source) come from the brand
    (`database/brands.py`), never hard-coded. The default brand's fallbacks
    reproduce the single-brand (v1.x) behaviour.
11. Permission checks use `Depends(require_permission("<perm>"))`; roles are
    per brand (`current_user["brand_role"]`, mirrored in
    `current_user["role"]`). Platform admin: `current_user["is_platform_admin"]`.

`current_user` (from `get_current_user`) carries: `id, email, full_name,
brand_id, brand_slug, brand_name, brand_role, role (= brand_role),
global_role, is_platform_admin, brands[]`.

## Brand catalog (`database/brands.py`)

`get_brand(id_or_slug)`, `list_brands(active_only=True)`, `default_brand()`,
`is_default_brand(ref)`, `brand_for_host(host)`, `invalidate_cache()`,
`sender_value(brand, key, env=None, default=None, env_for_all_brands=True)`.

Brand row: `id, slug, display_name, website_domain, hostnames[], unsub_salt,
is_active, branding{company, branding, form, dashboard, features, emailTeam},
sender{...}, created_at, updated_at`.

The catalog is cached for about 30 seconds per process; a newly created or
edited brand may take that long to be seen by every worker.

### `brands.sender` keys

All keys are optional. Lookup order is `brands.sender[key]` -> environment
variable (where one exists; for most identity keys only for the default brand)
-> built-in fallback. Set them in **Settings -> Brand** (admins) or via
`PATCH /api/brands/current`.

| key | meaning | default-brand fallback | other brands fallback |
|---|---|---|---|
| sending_enabled | the launcher runs this brand | true | false (until enabled) |
| cta_url | default CTA link | built-in placeholder - set it | `https://<website_domain>` |
| cta_text | CTA link text | built-in generic text | `See how <display_name> works` |
| utm_source | utm_source value on tracked links | built-in generic value | brand slug |
| alert_from | mailbox that sends failure alerts | env `ALERT_FROM`, else the brand's sending mailbox | the brand's sending mailbox |
| alert_to | who gets failure alerts | env `ALERT_TO` (none -> alerts are only logged) | env `ALERT_TO` |
| alert_to_name | greeting name in alert emails | none | none |
| ai_brief_default | product brief when a campaign has none | built-in default brief | "" (campaign must set `ai_brief`) |
| ai_company | how the AI introduces the company in prompts | website_domain, else display name | website_domain, else display name |
| ai_recipient_note / ai_tone | extra recipient context / tone for AI copy | "" / `professional` | "" / `professional` |
| reply_notify_to | who `reply_handler` notifies about new replies | env `NOTIFY_TO` | alert_to, then the brand's mailbox |
| dashboard_url | link used in notification emails | env / shared dashboard URL | `https://<hostnames[0]>`, else the shared dashboard URL |
| segment_alert_app_name / segment_alert_reply_to / segment_alert_from | low-lead segment alert email branding | built-in name / env `SEGMENT_ALERT_REPLY_TO` / first connected mailbox | built-in name / alert_to / first connected mailbox |
| daily_cap, min_gap, max_gap, start_hour, end_hour, max_total, ramp, ai_only, followup_engaged_only, segments, tz_offset_hours | pacing and targeting | env (`DAILY_CAP`, `MIN_GAP`, ...) / constants in `ops/smart_sender.py` | env / constants |

Pacing values fall back to the cron environment for every brand, so give a
brand-new mailbox a low `daily_cap` (and a low per-account
`email_accounts.daily_limit`) while it warms up, BEFORE setting
`sending_enabled: true`. Only the default brand can use the sender's built-in
template bodies; other brands' campaigns need an `ai_brief` (or explicit A/B
variants).

## Opt-outs, bounces and unsubscribe links

Token = `sha256(email + brand.unsub_salt)[:12]`. The default brand's salt is
`utilizereach-unsub-v1` - the same value v1.x used - so every unsubscribe link
already sent keeps working after the upgrade. New brands get a random salt.
New links carry `&b=<brand_id>`; the unsubscribe endpoint uses `b` when
present, and links without `b` are checked against every active brand's salt
(default brand first).

* An opt-out is recorded in **that brand's** `email_exclusions` /
  `email_unsubscribes` only: unsubscribing from brand A does not stop brand B.
* Hard bounces are also written to **`global_suppression`** - an invalid
  mailbox is invalid for everyone.
* The sender and campaign launches skip anything in the brand's exclusions,
  the brand's unsubscribes, or `global_suppression`.

## Sender (`ops/smart_sender.py`)

* `BRAND_ID` env (id or slug) selects the brand; unset -> the default brand
  (v1.x cron compatibility) with a warning. The whole run executes in
  `brand_scope(brand_id)`. Lock file `/tmp/smart_sender_<slug>.lock`.
* `ops/run_senders.py` is the launcher cron should call: it starts one sender
  process per **active** brand with `sending_enabled`, in parallel, each with
  its own `BRAND_ID`, prefixes each output line with `[slug]`, waits for all of
  them and exits non-zero if any failed. `ONLY_BRANDS=slug1,slug2` restricts a
  run; in a dry run (`SEND` unset or `0`) a brand named there runs even when it
  is not sending-enabled yet, so a new brand can be rehearsed.
* Per-brand Gmail: the default brand keeps using `backend/.gmail_tokens` when
  present (v1.x behaviour); every other brand uses its own connected mailbox
  row in `email_accounts` (the brand's row that holds a refresh token).
* `ops/bounce_handler.py` and `ops/reply_handler.py` loop over every active
  brand internally, each against that brand's own mailbox and sends
  (`BRAND_ID` limits them to one brand). `APPLY=1` makes them write changes.

## Celery and scripts

* The beat runs `celery_app.tasks.send_daily_campaign_all_brands`, which
  queues `send_daily_campaign(brand_id)` for each active brand (each reads its
  own `scheduler_settings`; the beat still fires at one fixed time).
* A Celery message without `brand_id` (queued before the upgrade) runs as the
  brand that owns its scrape job / lead, else the default brand
  (`utils/brand_context.task_brand_id`).
* Stand-alone scripts honour `BRAND_ID` (default: the default brand) via
  `utils/brand_context`.

## Operations

### Cron

`run_senders.py` and `smart_sender.py` must sit in the **same directory**
inside the backend container and run with `PYTHONPATH=/app`. One cron line
covers every brand. Example (host crontab, times in the server's timezone;
adjust the path and pacing):

```cron
# paced sender - all sending-enabled brands, once a day
0 9 * * *  cd /opt/utilizereach && docker compose cp ops/smart_sender.py backend:/app/smart_sender.py && docker compose cp ops/run_senders.py backend:/app/run_senders.py && docker compose exec -T -e PYTHONPATH=/app -e SEND=1 -e DAILY_CAP=20 backend python /app/run_senders.py >> /var/log/utilizereach-sender.log 2>&1

# reply + bounce handling (all brands)
0 */2 * * * cd /opt/utilizereach && docker compose cp ops/reply_handler.py backend:/app/reply_handler.py && docker compose exec -T -e PYTHONPATH=/app -e APPLY=1 backend python /app/reply_handler.py >> /var/log/utilizereach-replies.log 2>&1
30 20 * * * cd /opt/utilizereach && docker compose cp ops/bounce_handler.py backend:/app/bounce_handler.py && docker compose exec -T -e PYTHONPATH=/app -e APPLY=1 backend python /app/bounce_handler.py >> /var/log/utilizereach-bounces.log 2>&1
```

Run the sender line once with `SEND=0` (dry run) first. Do not delete the lock
files before a run - they are `flock` locks and free themselves when a run
exits.

### Adding a brand

1. As a platform admin: **Settings -> Brands** (or
   `POST /api/brands`). This also creates the brand's AI and scheduler
   settings and makes you its admin.
2. Switch into it, fill in branding, connect its mailbox(es) under **Email
   Accounts**, set its AI settings and a low `daily_cap`.
3. Add teammates under **Settings -> Users** with a role for this brand.
4. Optional: give it a dedicated hostname (`hostnames`) and point that host at
   the same frontend/backend - the brand is then pinned for that host and its
   public forms use its branding.
5. Rehearse with `SEND=0 ONLY_BRANDS=<slug>`, then enable `sending_enabled`.

## Control-plane API (`api/routers/auth.py` + `api/routers/brands.py`)

| Method & path | Who | Body / result |
|---|---|---|
| POST /api/auth/login | public | `{email, password, brand?}` -> `{access_token, token_type, user}` |
| GET /api/auth/me | auth | user incl. `brand_id, brand_slug, brand_name, brand_role, role, is_platform_admin, brands[], permissions[]` |
| GET /api/auth/roles | auth | `{roles:[{value,label,description,permissions}]}` |
| GET /api/brands/public-config | public | `{brand:{id,slug,display_name,website_domain}, config:{company,branding,form,dashboard,features,emailTeam,setup}}` (config.json shape, Host-resolved) |
| POST /api/brands/switch | auth | `{brand_id}` -> `{access_token, token_type, user}` |
| GET /api/brands/current | auth | active brand row (`branding`, `sender`, ...) |
| PATCH /api/brands/current | settings.manage | `{display_name?, website_domain?, branding?, sender?}` |
| GET /api/brands | platform admin | `{brands:[{...row, member_count, lead_count, campaign_count, sent_count}]}` |
| POST /api/brands | platform admin | `{slug, display_name, website_domain?, hostnames?, branding?, sender?}` -> `{brand}` (also creates its AI + scheduler settings, adds caller as admin) |
| PATCH /api/brands/{id} | platform admin | `{display_name?, website_domain?, hostnames?, is_active?, branding?, sender?}` |
| GET /api/brands/current/members | users.view | `{members:[{id, email, full_name, role, role_label, is_default, is_active, last_login, is_platform_admin}]}` |
| POST /api/brands/current/members | users.manage | `{email, full_name?, password?, role}` -> adds existing user or creates one |
| PATCH /api/brands/current/members/{user_id} | users.manage | `{role}` |
| DELETE /api/brands/current/members/{user_id} | users.manage | removes from THIS brand (not the account) |
| POST /api/brands/current/members/{user_id}/reset-password | users.manage | `{new_password}` |
| /api/auth/users* (legacy) | as before | now brand-scoped aliases of the members endpoints |

## Upgrading from v1.x

The migration is automatic and idempotent, but it rewrites every tenant table
(adds `brand_id`, composite keys and RLS), so take a backup first.

1. **Back up the database** (and keep the output of `crontab -l`):

   ```bash
   docker compose exec -T postgres pg_dump -U marketing -Fc marketing_ai > utilizereach-pre-v2.dump
   crontab -l > crontab-pre-v2.txt
   ```

   (Use your own `POSTGRES_USER` / `POSTGRES_DB` if you changed them.)
2. **Set `APP_DB_PASSWORD`** in `.env` to a long random value and make sure it
   reaches the backend, celery worker and celery beat containers.
3. **Pull v2.0.0, rebuild and restart:**

   ```bash
   git fetch --tags && git checkout v2.0.0
   docker compose up -d --build
   docker compose logs -f backend    # watch the migration finish
   ```

   The migration runs automatically when the backend starts. It creates the
   default brand, **backfills every existing row to it**, seeds its branding
   from your existing `config.json`, and makes every existing user a member of
   it: **existing admins stay admins and become platform admins**, every other
   existing user becomes a `member` (adjust roles afterwards in
   **Settings -> Users**). **Existing unsubscribe links keep working** (same
   salt).
4. **Switch the sender cron** from `smart_sender.py` to `ops/run_senders.py`
   (see [Cron](#cron)). The old line keeps working - with `BRAND_ID` unset the
   sender runs the default brand and logs a warning - but it will not send for
   any brand you add later.
5. Log in, check the dashboard numbers match, then add brands as needed.

### Rollback

The previous release cannot run on a migrated database (inserts without
`brand_id` would fail), so a rollback **restores the backup**:
`ops/multibrand_rollback.sh` stops the app containers, restores the dump,
checks out the previous commit, rebuilds and restores your saved crontab (see
the header of the script for its arguments). Anything written after the backup
(opens, clicks, replies, new sends) is lost - export it first if it matters.

For a row-level-security problem only, prefer the lighter switch:
`TENANCY_APP_ROLE=off` and restart the backend and Celery containers.

## Testing isolation

`backend/tests/multibrand/` is an automated cross-brand leak suite (RLS, every
GET route with the other brand's ids, by-id attacks, membership and role
checks, brand switching, secrets masking). It writes fixtures, so run it only
against a disposable or staging database. See its
[README](../backend/tests/multibrand/README.md).
