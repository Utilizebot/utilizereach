# Security Policy

We take the security of UtilizeReach seriously. Because UtilizeReach handles email accounts, OAuth tokens, contact data, and outbound sending, a vulnerability can have real impact — so we appreciate responsible disclosure and will work with you to resolve issues quickly.

## Supported versions

Security fixes are provided for the current **1.x** release line.

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

Please make sure you can reproduce the issue on a supported, up-to-date version before reporting. We generally patch the latest release rather than backporting to pre-1.0 builds.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, pull requests, or discussions.**

Instead, report privately using GitHub's built-in private vulnerability reporting:

1. Go to the repository's **Security** tab: https://github.com/Utilizebot/utilizereach/security
2. Click **"Report a vulnerability"** to open a private security advisory: https://github.com/Utilizebot/utilizereach/security/advisories/new
3. This creates a private channel visible only to you and the maintainers.

If you cannot use private advisories for some reason, contact the Utilizebot organization through GitHub at https://github.com/Utilizebot and ask for a secure channel — do not disclose details publicly first.

### What to include

To help us triage quickly, please provide:

- A clear description of the vulnerability and its impact.
- The affected version/commit and component (backend API, frontend, tracking/form endpoints, sending, ops scripts).
- Step-by-step reproduction instructions or a proof of concept.
- Any relevant configuration (without secrets — see below).

### Never include secrets in a report

**Do not paste credentials, tokens, or private data into a report.** That includes `.env` contents, your JWT secret, database passwords, Gmail OAuth client secrets or refresh tokens, LLM API keys, SerpAPI keys, or real recipient contact data. Redact them. If a secret was exposed as part of the vulnerability, tell us that it happened and **rotate it immediately** — don't send us the value.

## Response expectations

- **Acknowledgement:** within **3 business days** of your report.
- **Initial assessment:** within **7 business days**, including whether we can reproduce it and a preliminary severity.
- **Resolution:** timing depends on severity and complexity; we'll keep you updated on progress and coordinate a disclosure timeline with you. We aim to release fixes for high-severity issues as promptly as we reasonably can.

We'll credit reporters in the advisory if you'd like the acknowledgement (and you're welcome to remain anonymous).

## Scope

**In scope** — issues in the UtilizeReach codebase, such as:

- Authentication/authorization flaws (JWT handling, session/auth bypass, privilege escalation, multi-user data isolation).
- Injection (SQL, command, template), SSRF, and insecure deserialization.
- Cross-site scripting (XSS), CSRF, and other web vulnerabilities in the frontend or API.
- Vulnerabilities in the public **lead-capture form** and **open/click tracking** endpoints (e.g. unauthenticated data exposure, injection, abuse vectors).
- Exposure of secrets, tokens, or contact data through the application.
- Vulnerable dependencies with a demonstrable impact on UtilizeReach.

**Out of scope** — typically:

- Misconfiguration of a **self-hosted deployment** that you control (see below).
- Findings that require a compromised host, physical access, or a malicious administrator already holding valid credentials.
- Missing security hardening with no concrete exploit (e.g. "header X is not set") absent demonstrated impact.
- Social engineering, spam/abuse of the sending feature by the operator, denial of service through sheer volume, and automated scanner output without a working proof of concept.

## Self-hoster responsibilities

UtilizeReach is self-hosted software: **you are responsible for securing your own deployment.** At minimum:

- **Rotate the JWT secret** away from any example/default value, and keep it — and all `.env` values — out of version control.
- **Serve everything over HTTPS.** Terminate TLS at a reverse proxy in front of the app; don't expose the backend on plain HTTP.
- **Restrict and monitor the public endpoints** — the lead-capture form and the tracking (open/click/unsubscribe) endpoints are intentionally reachable without auth; put them behind a reverse proxy with sensible rate limiting and keep everything else (the API, admin UI, database, Redis) off the public internet.
- Keep Docker images, the host OS, and dependencies patched.
- Store Gmail OAuth credentials and LLM/SerpAPI keys securely, grant least privilege, and rotate them if you suspect exposure.
- Take regular, secured backups of your PostgreSQL data.

Configuration mistakes in your own environment aren't vulnerabilities in UtilizeReach, but if our defaults or documentation lead people toward an insecure setup, we want to know — that we'll treat as a valid report.

Thank you for helping keep UtilizeReach and its users safe.
