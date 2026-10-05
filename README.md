<p align="center">
  <img src="docs/img/banner.png" alt="UtilizeReach — self-hosted, source-available cold-email &amp; lead automation, by Utilizebot" width="860">
</p>

# UtilizeReach

[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Utilizebot/utilizereach?style=social)](https://github.com/Utilizebot/utilizereach/stargazers)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](#contributing)
[![Made with FastAPI](https://img.shields.io/badge/made%20with-FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)

**By [Utilizebot](https://github.com/Utilizebot).** A self-hosted platform for
AI-assisted lead capture and cold-email outreach — scrape and import leads,
segment them, generate personalized emails with an LLM, send them from multiple
sender identities at a safe warm-up pace, and track opens / clicks / replies /
bounces in a real-time dashboard.

> **License:** [PolyForm Noncommercial 1.0.0](./LICENSE) (source-available).
> **Noncommercial use is free** (personal, research, evaluation, education,
> nonprofits, government). **Any commercial use requires a separate commercial
> license from Utilizebot** — see
> [Commercial license & managed hosting](#-commercial-license--managed-hosting)
> below. This is a source-available license, not an OSI "open source" license.

## Screenshots

<!-- UI previews rendered from the product design — swap in live screenshots / a demo GIF anytime -->

| | |
|---|---|
| ![Dashboard](docs/img/dashboard.png)<br/>**Dashboard** — deliverability & engagement at a glance | ![AI emails](docs/img/emails.png)<br/>**AI emails** — per-recipient personalized drafts |
| ![Campaigns](docs/img/campaigns.png)<br/>**Campaigns** — A/B variants & follow-up sequences | ![Analytics](docs/img/analytics.png)<br/>**Analytics** — per-persona / segment / campaign |

> A look inside UtilizeReach. A live interactive demo is coming — ⭐ **star the repo** to get notified.

## Why UtilizeReach

- **Own your data / self-host.** Leads, mailboxes, and analytics stay on your
  server — nothing routed through a third-party SaaS.
- **No per-seat pricing.** Add users, personas, and mailboxes without a bill that
  scales with your headcount.
- **Source-available.** Read, audit, and modify the whole stack — no black box.
- **One stack, end to end.** Scrape → segment → generate → send → track →
  analyze, without stitching together four tools.
- **LLM-agnostic.** Bring Claude, Gemini, OpenAI, or any OpenAI-compatible
  endpoint (Ollama, self-hosted) — swap providers from Settings.

## Features

- **Lead capture & import** — config-driven public form, CSV/Excel import, and a
  flexible scraper.
- **Segments** — organize leads into modular, filterable segments.
- **AI email generation** — per-recipient personalized emails via your configured
  LLM provider (Claude, Gemini, OpenAI, or any OpenAI-compatible endpoint).
- **Multi-persona sending** — send from several verified sender identities
  (Gmail send-as aliases) with per-persona tone.
- **Warm-up sender** — paced outbound (configurable daily cap and per-send delay,
  business-hours window) with an optional automatic ramp, so new domains don't
  burst.
- **Campaigns + A/B** — targeted campaigns with A/B variants and follow-up
  sequences to non-repliers.
- **Tracking** — open pixel, click tracking, thread-based reply detection, and
  automatic bounce quarantine. Bounce-exclusive engagement so undelivered mail
  never counts as opened/clicked.
- **Analytics** — period-aware dashboard: deliverability, engagement funnel,
  per-persona / per-segment / per-campaign breakdowns.
- **Compliance** — one-click unsubscribe endpoint and exclusion lists.
- **Multi-brand workspaces** — run several brands (companies, clients,
  products) from one deployment with full data isolation, enforced in the app,
  by brand-scoped foreign keys, and by PostgreSQL row-level security.
- **Per-brand everything** — each brand has its own mailboxes and personas, AI
  settings, branding/theme (dashboard and public forms), sending caps and
  pacing, leads, segments, campaigns and analytics.
- **Brand switcher** — users who belong to several brands switch from the top
  bar; a brand can also be pinned to its own hostname.
- **Roles per brand + platform admins** — four roles (Admin, Manager, Member,
  Viewer) assigned per brand; platform admins create and manage brands.
- **Opt-outs that respect brands** — unsubscribes and exclusions are per brand,
  while hard bounces go to a global suppression list shared by every brand.
- **What's Winning** — analytics on what performs best (AI vs. template copy,
  sending accounts, subject lines, segments, owners / account managers) plus
  data-grounded AI recommendations from your configured LLM.
- **Follow-up control** — edit a campaign's follow-up steps and optionally
  send follow-ups only to contacts who opened or clicked (engagement gating).
- **Owner / account-manager attribution** — assign a lead owner (per lead or
  for a whole segment) and an account manager per campaign, and compare their
  results.
- **Excel export** — download the filtered sent-emails view as an
  Excel-ready CSV.

## Stack

| Layer     | Tech |
|-----------|------|
| Backend   | FastAPI (Python 3.12) |
| Frontend  | React 19 + TypeScript + Vite + Tailwind |
| Database  | PostgreSQL 16 |
| Queue     | Redis + Celery |
| Delivery  | Docker Compose |
| Email     | Gmail API (send-as aliases) |

## An open-source alternative to Instantly, Lemlist, Smartlead & Apollo

Instantly, Lemlist, Smartlead, and Apollo are polished, well-supported managed
SaaS products — if you want a hosted tool and don't mind cloud pricing, they're
great. UtilizeReach competes on a different axis: **self-hosting, data
ownership, and pricing model.** Feature-wise the outreach engine is comparable;
where UtilizeReach differs is that you run it on your own server and own every
row.

| | **UtilizeReach** | Instantly / Lemlist / Smartlead / Apollo |
|---|:---:|:---:|
| Self-hosted | ✅ | ❌ (cloud SaaS) |
| Own your data / on-prem | ✅ | ❌ (data on their cloud) |
| Source-available code | ✅ | ❌ (proprietary) |
| Pricing model | Free noncommercial · commercial license for business use | Paid SaaS, per seat |
| Multi-inbox / sender personas | ✅ | ✅ |
| Warm-up pacing | ✅ | ✅ |
| A/B + follow-up sequences | ✅ | ✅ |
| Open / click / reply tracking | ✅ | ✅ |
| AI email generation | ✅ (bring your own LLM) | ✅ |
| Built-in lead scraper | ✅ | ✅ (varies by product) |
| Unsubscribe + compliance tooling | ✅ | ✅ |

The takeaway isn't "they can't track or warm up" — they can. It's that with
UtilizeReach **the whole stack runs on infrastructure you control, with no
per-seat bill.**

## Quick start

```bash
git clone https://github.com/Utilizebot/utilizereach.git
cd utilizereach

# 1. Copy and fill in environment variables
cp .env.example .env
cp backend/.env.example backend/.env        # set JWT_SECRET, DB creds, LLM key, Google OAuth
echo "APP_DB_PASSWORD=$(openssl rand -hex 24)" >> .env   # password for the least-privilege app_rw DB role

# 2. Bring up the stack
docker compose up -d --build

# 3. Open the app and complete the Setup Wizard
#    (system check -> admin account -> API keys -> company branding)
open http://localhost:3000
```

The first account you register in the Setup Wizard becomes the admin of the
default brand and a platform admin.

`APP_DB_PASSWORD` lets the app connect as the least-privilege `app_rw`
database role, so PostgreSQL row-level security isolates brands even for raw
SQL. Without it the app connects as the schema owner (fine for a single brand;
set it before adding a second one). See
[docs/MULTIBRAND.md](./docs/MULTIBRAND.md#the-app_rw-role-app_db_password-and-tenancy_app_role).

**Upgrading from v1.x?** Back up the database first, then follow
[Upgrading from v1.x](./docs/MULTIBRAND.md#upgrading-from-v1x) — the migration
runs automatically on backend start and moves all existing data into the
default brand.

## Connecting email (Gmail) — read this first

Sending runs on the **Gmail API** with OAuth (no SMTP passwords stored). You create a
Google Cloud OAuth client, drop the ID/secret in `.env`, then click **Connect Google
account** in the app. Each account can send from multiple **send-as aliases** used as
personas.

👉 **Full step-by-step guide: [docs/EMAIL_SETUP.md](./docs/EMAIL_SETUP.md)** — Google Cloud
project, enabling the Gmail API, OAuth consent screen (incl. the 7-day test-mode token
caveat), the exact redirect URI, connecting accounts, setting up personas, deliverability
(SPF/DKIM/DMARC), and troubleshooting (`redirect_uri_mismatch`, unverified-app, etc.).

Quick version:
```env
# .env
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxx
PUBLIC_BASE_URL=http://localhost:8000     # must match the redirect URI host in Google Cloud
```
Authorized redirect URI to register in Google Cloud:
`<PUBLIC_BASE_URL>/api/email-accounts/google/callback` — then `docker compose restart backend`
and connect under **Email Accounts**.

## Multi-brand

One deployment can serve many brands. Every brand is a fully isolated
workspace — its own mailboxes, personas, AI settings, branding, sending caps,
leads, segments, campaigns, opt-outs, analytics and team. Platform admins
create brands under **Settings → Brands**; brand admins configure their brand
under **Settings → Brand** and invite teammates under **Settings → Users**.
Users who belong to several brands switch between them from the top bar.

Isolation is enforced in three layers (app-level brand scoping, brand-scoped
foreign keys, and PostgreSQL row-level security), and an automated cross-brand
leak suite lives in `backend/tests/multibrand/`. The cron sender runs every
sending-enabled brand in one go via `ops/run_senders.py`.

👉 **Architecture, rules for contributors, the sender settings, the API, and the
v1.x upgrade guide: [docs/MULTIBRAND.md](./docs/MULTIBRAND.md).**

## Configuration

- **Branding** — set your company name, logo, colors, and form copy in the Setup
  Wizard for the default brand, and per brand under **Settings → Brand**; no
  code changes needed.
- **LLM provider** — Settings → Email AI. Supports `claude`, `gemini`, `openai`,
  or `custom` (any OpenAI-compatible `base_url`, e.g. Ollama/self-hosted).
- **Sending / warm-up** — after connecting Gmail (above), the paced warm-up sender
  `ops/smart_sender.py` runs from cron via `ops/run_senders.py` (one sender per
  sending-enabled brand); reply + bounce handling from `ops/reply_handler.py` and
  `ops/bounce_handler.py`. Daily caps and pacing can be set per brand. See
  [docs/MULTIBRAND.md](./docs/MULTIBRAND.md#cron) for a cron example.

## Roles & permissions

UtilizeReach has built-in role-based access control, and **roles are per
brand**: the same person can be an Admin in one brand and a Viewer in another.
The first account created in the Setup Wizard is the **Admin** of the default
brand (and a platform admin); brand admins add teammates and assign roles for
their brand in **Settings → Users**.

| Role | Can do |
|------|--------|
| **Admin** | Everything, including managing users, mailboxes, API keys, and system settings. |
| **Manager** | Run the whole outreach operation — create/edit/delete campaigns, import/work/delete leads, send, manage segments & exclusions, view the team. Cannot manage users, credentials, or system settings. |
| **Member** | Create & run campaigns, import and work leads, send email, run the scraper. Cannot delete campaigns/leads or change team/config. |
| **Viewer** | Read-only access to dashboards, campaigns, leads, and analytics. |

**Platform admins** are a separate, deployment-wide flag: they can create,
edit and deactivate brands and switch into any brand. Removing someone from a
brand takes effect on their next request.

Permissions are **action-gated** (every authenticated user can read; roles decide
who can create/edit/delete/manage) and defined in one place —
`backend/api/permissions.py`. Each action API requires the matching permission
(`require_permission`), and the frontend mirrors the same matrix via the
`permissions` list on `/api/auth/me`. To add a capability, add the permission
string, grant it to the right roles, and depend on it in the endpoint.

## 💼 Commercial license & managed hosting

**Noncommercial use is free** — personal, research, evaluation, education,
nonprofits, and government use are covered by the
[PolyForm Noncommercial 1.0.0](./LICENSE) license at no cost.

**Commercial, business, or production use requires a commercial license from
Utilizebot** — this includes running outreach for a business, offering
UtilizeReach (or a derivative) as a hosted/managed service, or any use for
commercial advantage.

**A hosted / managed version is available** if you'd rather not run the
infrastructure yourself. Join the waitlist or request a commercial license by:

- Opening an issue on this repository, or
- Reaching the Utilizebot org at <https://github.com/Utilizebot>.

## Security notes

- All secrets live in `.env` files (git-ignored). Do not commit `.env`, OAuth
  client secrets, `*.lic`, or token files.
- The public tracking/form endpoints should be rate-limited behind your reverse
  proxy before production use.
- You are responsible for complying with anti-spam and data-protection law
  (CAN-SPAM, GDPR, PDPA, etc.) in the jurisdictions you email into. UtilizeReach
  ships one-click unsubscribe, exclusion lists, automatic bounce handling, and
  warm-up pacing to support **legitimate, permission-based** outreach — consent
  is your responsibility.

## Contributing

Contributions are welcome — the flow is the standard GitHub one:

1. **Fork** this repo to your account.
2. Create a **branch** and make your change.
3. Open a **Pull Request** back here — we review and merge.

See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for local setup, the PR checklist, and the **Contributor License Agreement** — your contributions are licensed to Utilizebot for use (including commercially) while staying available to everyone under PolyForm Noncommercial.

New here? Look for [`good first issue`](https://github.com/Utilizebot/utilizereach/labels/good%20first%20issue) and [`help wanted`](https://github.com/Utilizebot/utilizereach/labels/help%20wanted). Questions or ideas → [Discussions](https://github.com/Utilizebot/utilizereach/discussions).

## License

Commercial or production use — running outreach for a business, offering it (or
a derivative) as a hosted/managed service, or any use for commercial advantage —
requires a commercial license from **Utilizebot**. To request one, open an issue
on this repository or contact Utilizebot via <https://github.com/Utilizebot>.
See [Commercial license & managed hosting](#-commercial-license--managed-hosting)
for details, and [LICENSE](./LICENSE) for the full PolyForm Noncommercial 1.0.0
text.
