# Contributing to UtilizeReach

Thanks for your interest in improving UtilizeReach — the self-hosted, source-available platform for AI-assisted lead capture and cold-email outreach. Bug reports, docs fixes, and well-scoped features are all welcome.

This guide covers how to get a local instance running, how the project is laid out, and the branch/PR conventions we follow.

---

## Before you start: licensing of contributions

UtilizeReach is released under the **PolyForm Noncommercial License 1.0.0**. This is a **source-available** license, not an OSI "open source" one:

- **Noncommercial use is free** — personal, research, evaluation, education, nonprofit, and government use.
- **Any commercial, production, or business use requires a separate commercial license** from Utilizebot. To request one, open a GitHub issue on the repo or reach the org at https://github.com/Utilizebot.

**By submitting a contribution (a pull request, patch, or any other material) you agree that your contribution is licensed under the same PolyForm Noncommercial 1.0.0 terms as the rest of the project, and that the commercial-use restriction applies to it.** Please only contribute code you have the right to license this way. Don't paste in code copied from projects under incompatible licenses.

If that model doesn't work for your use case, get in touch through GitHub before opening a PR.

---

## Local development setup

You'll need **Docker** and **Docker Compose**. That's the whole toolchain — Postgres, Redis, Celery, the FastAPI backend, and the React frontend all come up together.

```bash
# 1. Clone
git clone https://github.com/Utilizebot/utilizereach.git
cd utilizereach

# 2. Create your environment file from the template
cp .env.example .env
#    Then open .env and fill in the values (JWT secret, DB creds, LLM API keys, etc.)

# 3. Build and start the full stack
docker compose up -d --build

# 4. Open the app
#    http://localhost:3000
```

On first launch, complete the **setup wizard** in the browser — it creates your first admin user and walks you through the core configuration.

For connecting a Gmail account and configuring send-as personas (OAuth, aliases, sending), see **[docs/EMAIL_SETUP.md](docs/EMAIL_SETUP.md)**.

To follow logs while developing:

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

---

## Project layout

```
utilizereach/
├── backend/        FastAPI (Python 3.12) — API, auth, campaigns,
│                   sending, tracking, analytics, Celery tasks
├── src/            React 19 + TypeScript + Vite + Tailwind frontend
├── ops/            Operational scripts — cron jobs (paced sender,
│                   warm-up ramp, follow-ups, maintenance)
├── docs/           Documentation, including EMAIL_SETUP.md
└── docker-compose.yml
```

- **backend/** — Python service. Business logic, database models, and background jobs live here. PostgreSQL 16 for storage, Redis + Celery for the queue and scheduled work.
- **src/** — the single-page app. Talks to the backend API.
- **ops/** — host-side cron scripts that drive paced sending and warm-up; these are what you schedule on your server in production.

---

## Running lint and the build

Run these locally before opening a PR so CI passes on the first try.

**Backend (Python):**

```bash
cd backend
ruff check .            # lint
ruff format --check .   # formatting
pytest                  # tests
```

**Frontend (React/TypeScript):**

```bash
npm install
npm run lint            # ESLint
npm run build           # type-check + production build
```

If you added a dependency, commit the updated lockfile (`requirements.txt` / `package-lock.json`) alongside your change.

---

## Branch and pull-request process

1. **Fork** the repo (or branch, if you have push access).
2. Create a topic branch off `main`:
   ```bash
   git checkout -b fix/bounce-quarantine-edge-case
   ```
   Use a short prefix that describes the change: `fix/…`, `feat/…`, `docs/…`, `chore/…`, `refactor/…`.
3. Make focused commits. Keep a PR to one logical change where you can — smaller PRs get reviewed faster.
4. Make sure lint, the build, and tests pass locally.
5. Push and open a **pull request against `main`**. In the description, explain *what* changed and *why*, link any related issue, and include screenshots for UI changes.
6. Be responsive to review comments. A maintainer will merge once it's approved and green.

### Commit style

We follow **Conventional Commits**. The subject line is:

```
<type>(<optional scope>): <short imperative summary>
```

Examples:

```
feat(campaigns): add A/B variant weighting
fix(tracking): don't count bounced mail as opened
docs(email): clarify Gmail send-as alias setup
chore(deps): bump celery to 5.4
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`. Keep the summary in the imperative mood ("add", not "added"), under ~72 characters, and put detail in the body if needed.

---

## Reporting bugs and requesting features

- **Bugs:** open a GitHub issue with steps to reproduce, what you expected, what happened, and your environment (OS, Docker version, relevant logs). **Never paste secrets** — no `.env` contents, API keys, OAuth tokens, or credentials.
- **Security vulnerabilities:** do **not** open a public issue. Follow the process in [SECURITY.md](SECURITY.md).
- **Features:** open an issue describing the use case first so we can align on scope before you build.

---

## A note on outreach and compliance

UtilizeReach is a tool for **legitimate, permission-based** outreach. It ships with one-click unsubscribe, exclusion lists, automatic bounce quarantine, and warm-up pacing precisely so it can be used responsibly. When contributing, keep that framing intact — features that make lawful, consent-based emailing easier are in scope; features designed to evade anti-spam controls or hide sender identity are not.

---

## Code of Conduct

Participation in this project is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By taking part, you agree to uphold it.

Thanks for contributing.
