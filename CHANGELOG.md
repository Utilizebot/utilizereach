# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-10-05

Multi-brand release: one deployment can now host several fully isolated
brands (workspaces). Also includes role-based access control and the analytics
and follow-up features added since 1.0.0. **This release migrates the
database schema** — read the upgrade notes below before upgrading.

### Added

- **Multi-brand (multi-tenant) workspaces.** Each brand has its own leads, segments, campaigns, sends, mailboxes and personas, AI settings, scheduler settings, branding/theme, sending caps and pacing, opt-out lists, analytics, API keys and team. Existing single-brand installs keep working as the *default brand*. See [docs/MULTIBRAND.md](docs/MULTIBRAND.md).
- Three layers of brand isolation: automatic brand scoping of every tenant-table query in the app (fail-closed when no brand is active), composite `(id, brand_id)` foreign keys, and PostgreSQL row-level security enforced through a least-privilege `app_rw` database role.
- Brand switcher in the top bar for users who belong to several brands; brands can optionally be pinned to dedicated hostnames (public forms and pre-login branding follow the host).
- **Platform admins** (deployment-wide) who create, edit and deactivate brands from **Settings → Brands**; brand admins edit their own branding and sender settings under **Settings → Brand**.
- Control-plane API: `/api/brands` (list/create/edit), `/api/brands/current` (+ members), `/api/brands/switch`, and the public, Host-resolved `/api/brands/public-config`.
- Per-brand sender settings (`brands.sender`: sending on/off, daily cap and pacing, CTA, UTM source, alert recipients, AI identity and tone) with environment fallbacks.
- `ops/run_senders.py` launcher that runs one paced sender per sending-enabled brand in parallel (`ONLY_BRANDS` to restrict, dry-run rehearsal for new brands); `ops/reply_handler.py` and `ops/bounce_handler.py` now process every active brand against its own mailbox.
- Global hard-bounce suppression list shared by all brands (an invalid mailbox is invalid everywhere), while unsubscribes and exclusions stay per brand.
- Role-based access control with four roles — **Admin**, **Manager**, **Member**, **Viewer** — assigned **per brand**, and a central permission matrix (`backend/api/permissions.py`) shared by backend and frontend. `GET /api/auth/roles` returns the role catalog; `/api/auth/me` includes the resolved `permissions`, the active brand and the user's brands.
- **What's Winning** page: performance breakdowns (AI vs. template, sending account, subject lines, segment, owner, account manager) and AI-generated, data-grounded recommendations (`/api/insights/*`).
- Follow-up sequence control: edit a campaign's follow-up steps from the UI/API, and optional engagement gating so follow-ups go only to contacts who opened or clicked.
- Owner / account-manager attribution: assign a lead owner per lead or per segment, and an account manager per campaign.
- Comma-separated multi-segment targeting for a campaign in the sender.
- Excel-ready CSV export of the filtered sent-emails view.
- Automated cross-brand isolation test suite (`backend/tests/multibrand/`) covering RLS, every GET route, by-id attacks, membership/role changes, brand switching and secrets masking.

### Changed

- The database migration runner applies `database/multibrand.sql` on every backend start (idempotent, under an advisory lock).
- Former singletons — email AI settings and scheduler settings — are now one row per brand; segment keys, exclusions, unsubscribes, social accounts and stakeholders are unique per brand. A mailbox still belongs to exactly one brand.
- The Celery beat fans the daily campaign out to every active brand; tasks carry a `brand_id`.
- Unsubscribe links now carry the brand (`&b=<brand_id>`); links sent by 1.x (without it) still work.
- The legacy `/api/auth/users*` endpoints are now brand-scoped aliases of the brand-members endpoints.
- Deactivated accounts, and users removed from a brand, are rejected on their next request (previously an existing token kept working).
- The frontend attaches the auth token to all API requests automatically and redirects to login on session expiry.

### Security

- Blanket authentication on all management API routers, with per-action permission checks (`require_permission`) on every create/edit/delete/manage endpoint. Public endpoints (tracking pixel/click, unsubscribe, lead capture, login, Google OAuth callback, pre-login branding) remain open by design.
- Row-level security on every tenant table; the app role is `NOSUPERUSER`/`NOBYPASSRLS` and cannot run DDL.
- The active brand comes only from the authenticated membership or the `Host` header; `X-Forwarded-Host` and `X-Brand*`-style headers are ignored, and membership is re-checked on every request.
- Mailbox OAuth tokens are never returned by the API, and the stored AI API key is shown unmasked to brand admins only.

### Upgrade notes (from 1.x)

1. **Back up the database first** (`pg_dump`) and save your crontab.
2. Set `APP_DB_PASSWORD` in `.env` (it must reach the backend and Celery containers) so the app connects as the least-privilege `app_rw` role.
3. Rebuild and restart (`docker compose up -d --build`). The migration runs automatically on backend start: it creates the default brand, backfills every existing row to it, makes existing admins admins of the default brand **and platform admins** (other users become members), and keeps existing unsubscribe links working.
4. Point the sender cron at `ops/run_senders.py` instead of `smart_sender.py` (the old line still works for the default brand only).
5. Rollback = restore the backup (`ops/multibrand_rollback.sh`); 1.x cannot run on a migrated database. For a row-level-security problem only, `TENANCY_APP_ROLE=off` reverts to the owner connection.

Full guide: [docs/MULTIBRAND.md → Upgrading from v1.x](docs/MULTIBRAND.md#upgrading-from-v1x).

## [1.0.0] - 2026-08-18

Initial public, source-available release of UtilizeReach.

### Added

- Search-driven lead scraper (SerpAPI) plus CSV/Excel import for building lead lists.
- Modular lead segments for organizing and targeting contacts.
- AI-written, personalized emails with a choice of LLM provider (Claude, Gemini, OpenAI, or any OpenAI-compatible endpoint such as Ollama).
- Multi-persona sending through the Gmail API using send-as aliases.
- Paced warm-up sender with optional automatic ramp-up.
- Campaigns with A/B variants and multi-step follow-up sequences.
- Open, click, and thread-based reply tracking, with automatic bounce quarantine so undelivered mail never counts as engagement.
- One-click unsubscribe and exclusion lists for compliant, permission-based outreach.
- Period-aware analytics covering deliverability, the engagement funnel, and per-persona, per-segment, and per-campaign breakdowns.
- Config-driven public lead-capture forms with UTM attribution.
- Multi-user support with a guided setup wizard.
- Docker Compose deployment for self-hosting the full stack.

[Unreleased]: https://github.com/Utilizebot/utilizereach/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/Utilizebot/utilizereach/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/Utilizebot/utilizereach/releases/tag/v1.0.0
