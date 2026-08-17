# Connecting Email (Gmail API) — full guide

UtilizeReach sends and tracks email through the **Gmail API** using OAuth 2.0.
You connect one or more Google accounts; each account can send from its own
**send-as aliases**, which UtilizeReach uses as sending *personas*. No SMTP
passwords are stored — only OAuth tokens you authorize.

This guide takes ~10–15 minutes. Do it once per Google account you want to send from.

---

## What you'll end up with

- A Google Cloud **OAuth client** (`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`) in your `.env`.
- One authorized redirect URI pointing back at UtilizeReach.
- One or more Gmail accounts connected inside the app (**Email Accounts** page).
- Optional: multiple **send-as aliases** per account, used as distinct sender personas.

---

## Prerequisites

- A Google account (personal Gmail, or a Google Workspace account).
- UtilizeReach running and reachable at a known URL (your `PUBLIC_BASE_URL`).
  - Local dev: `http://localhost:8000` (backend) — Google allows `http://localhost`.
  - Production: an **HTTPS** URL (e.g. `https://mail.yourdomain.com`). Gmail OAuth
    requires HTTPS for non-localhost redirect URIs.

---

## Step 1 — Create a Google Cloud project

1. Go to <https://console.cloud.google.com/>.
2. Top bar → **project selector** → **New Project** → name it (e.g. `utilizereach`) → **Create**.

## Step 2 — Enable the Gmail API

1. In the project, open **APIs & Services → Library**.
2. Search **Gmail API** → open it → **Enable**.
   *(Optional: also enable **People API** if you want richer profile info.)*

## Step 3 — Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. **User type**:
   - **Internal** — only if you use Google Workspace and will only connect accounts in
     your own organization. Best option: no verification needed, tokens don't expire.
   - **External** — for personal Gmail or connecting outside accounts. Choose this if unsure.
3. Fill app name, support email, developer email → **Save and Continue**.
4. **Scopes** — you don't have to add them here (the app requests them at connect time),
   but the app uses:
   - `gmail.send` — send email
   - `gmail.readonly` — read for reply/bounce detection
   - `gmail.settings.basic` + `gmail.settings.sharing` — read your send-as aliases (personas)
   - `userinfo.email`, `openid` — identify the connected account
5. **Test users** (External + "Testing" mode): add every Gmail address you'll connect.

> ⚠️ **Important — token expiry in "Testing" mode.** While your OAuth consent screen is
> in **Testing** (unverified), Google **expires refresh tokens after 7 days**, so you'd
> have to reconnect weekly. To avoid that, either:
> - use **Internal** (Google Workspace) — no expiry, no verification; **or**
> - **Publish** the app (OAuth consent screen → *Publish app*). For personal use with a
>   handful of accounts this works immediately; Google's **verification** is only required
>   before the consent screen is shown to many external users, and unverified apps still
>   work (with an "unverified app" warning you can click through) for your own accounts.

## Step 4 — Create the OAuth client credentials

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. **Application type: Web application**.
3. **Authorized redirect URIs → Add URI**, exactly (no trailing slash):

   ```
   <PUBLIC_BASE_URL>/api/email-accounts/google/callback
   ```

   - Local dev: `http://localhost:8000/api/email-accounts/google/callback`
   - Production: `https://mail.yourdomain.com/api/email-accounts/google/callback`

   This must match `PUBLIC_BASE_URL` **exactly** or you'll get `redirect_uri_mismatch`.
4. **Create** → copy the **Client ID** and **Client secret**.

## Step 5 — Add the credentials to UtilizeReach

Put these in your `.env` (root) — see `.env.example`:

```env
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
# The public URL the backend is reached at — MUST match the redirect URI host above.
PUBLIC_BASE_URL=http://localhost:8000        # or https://mail.yourdomain.com in prod
```

Then restart the backend so it picks up the env:

```bash
docker compose restart backend celery_worker celery_beat
```

> These are read from the environment at runtime (not the Setup Wizard DB), so they must
> be in `.env` and the backend restarted.

## Step 6 — Connect your Gmail account in the app

1. Log in to UtilizeReach → **Email Accounts**.
2. Click **Connect Google account** (this hits `/api/email-accounts/google/auth`).
3. Google shows the consent screen → pick the account → allow the requested scopes.
   - If you see an **"unverified app"** warning (External + not verified), click
     **Advanced → Go to … (unsafe)** to proceed — that's expected for your own app.
4. Google redirects back to `/api/email-accounts/google/callback`; the account now appears
   as **connected**. Tokens are stored server-side; no password is kept.

## Step 7 — Set up sending personas (send-as aliases)

UtilizeReach can send from multiple identities on one connected account using Gmail's
**send-as aliases**.

1. In **Gmail → Settings → Accounts and Import → "Send mail as" → Add another email
   address**, add and verify each alias (e.g. `nancy@yourdomain.com`, `sales@yourdomain.com`).
   These must be addresses you're authorized to send as (your domain).
2. Back in UtilizeReach → **Email Accounts → Personas** picks up the verified aliases
   automatically (via the `gmail.settings.sharing` scope).
3. Assign personas to campaigns; the warm-up sender rotates through them.

---

## Deliverability (do this before real sending)

Cold email fails without proper domain auth. For each sending domain:

- **SPF** — authorize Google to send for your domain.
- **DKIM** — enable DKIM signing (Workspace) / your domain's DKIM.
- **DMARC** — publish a DMARC policy.
- **Warm up** — UtilizeReach paces sending (configurable daily cap + delay + business-hours
  window, optional auto-ramp) via `ops/smart_sender.py`. Start low; don't blast a cold domain.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `redirect_uri_mismatch` | The redirect URI in Google Cloud must equal `PUBLIC_BASE_URL` + `/api/email-accounts/google/callback` exactly (scheme, host, port, no trailing slash). |
| `Google OAuth not configured` | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` missing from `.env`; add them and restart the backend. |
| Have to reconnect every ~7 days | Consent screen is in **Testing**. Publish the app, or use an **Internal** (Workspace) app. |
| "Unverified app" warning | Expected for your own unpublished app — **Advanced → Go to …**. Submit for verification only if exposing to many external users. |
| Personas/aliases don't show | Add + **verify** the send-as alias in Gmail settings first; reconnect if you added scopes later. |
| Behind Cloudflare/HTTPS proxy, callback breaks | Set `PUBLIC_BASE_URL` to the public HTTPS URL explicitly (header-derived scheme is unreliable behind proxies). |
