# Google Analytics 4 integration

Each brand can connect its own **Google Analytics 4** property, read-only, from
**Settings → Integrations**. The Dashboard then shows:

- **Website live**: active users in the last 30 minutes (GA's realtime
  window), users per minute over that time, and the top pages (by page
  title), countries and devices of those visitors.
- **From your email campaigns**: sessions, users and key events from visits
  that came from your outreach emails (`utm_source` = the brand's outreach
  source). They are broken down by campaign (`utm_campaign`), by sender
  persona (`utm_term`), by day and by landing page, next to the site's overall
  totals and top traffic sources.

No tracking tag is added anywhere. UtilizeReach only *reads* the GA4 property
your website already reports to, through the Google Analytics Data and Admin
APIs.

## How the numbers line up with your outreach

The sender tags every link to the brand's website domain with UTM parameters:

| parameter | value | shows up in GA4 as |
|---|---|---|
| `utm_source` | the brand's outreach source (see below) | Session source |
| `utm_medium` | `email` | Session medium |
| `utm_campaign` | the campaign name, slugified | Session campaign |
| `utm_content` | the A/B variant | Session manual ad content |
| `utm_term` | the sending persona, slugified | Session manual term |

The "From your email campaigns" panel filters GA4 on the **source** (exact
match, case-insensitive). By default it uses the same source the sender uses:
the brand's `sender.utm_source` (**Settings → Brand**). If that is not set, it
falls back to `utilizereach-outreach` for the default brand and to the brand
slug for other brands. You can override it per brand in Settings →
Integrations, for example if your links were tagged by another tool.

## Who can do what

| | permission | roles |
|---|---|---|
| See the Dashboard cards and the connection status | `analytics.view` | everyone (while *Show on Dashboard* is on) |
| Connect, pick the property, change the source, show/hide on the Dashboard, disconnect | `settings.manage` | brand admins, platform admins |

*Show on Dashboard* off is enforced by the API too: `/realtime`, `/report` (its GA part) and
`/summary` then return no data to anyone without `settings.manage`.

The connection belongs to the **brand**, not to the person who connected it.
One brand can never see another brand's connection or data.

## One-time setup (whoever runs the server)

Use the **same Google Cloud project and OAuth client** you already use for
Gmail sending ([EMAIL_SETUP.md](./EMAIL_SETUP.md)). No new environment
variables are needed: the integration uses `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` and `PUBLIC_BASE_URL` (or `BACKEND_URL` /
`FRONTEND_URL`), exactly like the Gmail connection.

1. **Enable two APIs.** In Google Cloud Console → **APIs & Services →
   Library**, find and **Enable** both:
   - **Google Analytics Data API**
   - **Google Analytics Admin API**

   It can take a few minutes before Google accepts calls after enabling.
2. **Add the redirect URI.** Go to **APIs & Services → Credentials**, open your
   OAuth 2.0 *Web application* client, and add this to **Authorized redirect
   URIs**. Keep the Gmail one as well.

   ```
   <PUBLIC_BASE_URL>/api/integrations/google-analytics/callback
   ```

   For example `https://reach.example.com/api/integrations/google-analytics/callback`
   (local dev: `http://localhost:8000/api/integrations/google-analytics/callback`).
   It must match exactly, with no trailing slash. Admins can copy the exact
   value from Settings → Integrations.
3. **Check the OAuth consent screen** (APIs & Services → OAuth consent
   screen):
   - **External**: add the scope
     `https://www.googleapis.com/auth/analytics.readonly` under *Data access /
     Scopes*. While the app is in *Testing*, add every Google account that
     will connect as a **test user**. In Testing mode Google expires refresh
     tokens after 7 days, so you would have to reconnect weekly. Publish the
     app to avoid that (same caveat as Gmail).
   - **Internal** (Google Workspace): only accounts in that Workspace can
     connect. Use (or create) a Workspace account and grant it access to the
     GA4 property (next step).
4. **Give the Google account access to the property.** In Google Analytics →
   **Admin → Property access management**, the account you will connect needs
   at least the **Viewer** role on the GA4 property.

## Connect a brand (brand admin)

1. Switch to the brand, then open **Settings → Integrations → Google Analytics
   → Connect**.
2. Pick the Google account from step 4 in Google's account chooser and allow
   **"See and download your Google Analytics data"**. If you untick it, the
   connection is refused and you are asked to try again.
3. You come back to Settings → Integrations, where the connection is saved
   for you (this takes a second). Only the admin who clicked Connect, still
   signed in to the same brand, can finish it, within 10 minutes. A connect
   link forwarded to someone else cannot attach *their* Google account to
   your brand.
4. **Pick the GA4 property.** The list shows every property the account can
   read. If there is only one, it is selected for you.
5. Check the **outreach source** to highlight. It defaults to the brand's
   sender `utm_source`; leave it unless your links use a different source.
6. Leave **Show on Dashboard** on, and the cards appear on the Dashboard for
   everyone in the brand. Turned off, they are hidden and the data is only
   available to brand admins.

To switch Google accounts, click **Switch account**: Google shows its account
chooser. Connecting a different account keeps your source and Dashboard
choices but asks for the property again. **Disconnect** removes the brand's
stored connection (see below).

## Data freshness, caching and quotas

- **Realtime** covers the last 30 minutes and is refreshed at most every
  **30 seconds** per brand. Viewers polling the Dashboard share one cached
  answer per server process. The big number is GA's de-duplicated count of
  active users over those 30 minutes, not a "this second" figure.
- **Reports** (totals, sources, the email panel) are cached for **5 minutes**
  per brand and period. GA4 processes data with a delay: the last few hours
  (sometimes longer) can still change, so today's numbers usually lag the
  realtime card.
- **Periods**: `1` = today only; `7`, `28`, `30`, `90` = the last N days
  including today, in the property's time zone.
- **The property list** is cached for 5 minutes.
- **Errors only an admin can fix** (`api_disabled`, `permission_denied`,
  `invalid_property`) are remembered for 5 minutes per server process, so a
  misconfigured brand does not call Google on every poll. Saving the settings
  or reconnecting clears them at once; a fix made only in Google (enabling an
  API, granting access) shows up within 5 minutes.
- **Access tokens** (1 hour, minted from the stored refresh token) are kept in
  memory and reused until they expire, instead of being renewed on every
  refresh.
- Google calls run on a small thread pool of their own (8 per server
  process), so a slow Google never ties up the threads the rest of the API
  uses. Each call times out after 10 seconds; the realtime reports and the
  report batches are requested in parallel.
- **Quotas**: Google limits Data API usage per property (hourly and daily
  token buckets, with a separate bucket for realtime). The caching above keeps
  usage low. If a quota or a short Google outage is hit anyway, the last good
  numbers stay on screen with a note, and they refresh on their own once
  Google answers again.

## Security and privacy

- Scopes: `analytics.readonly`, plus `openid` and `userinfo.email` only to
  show which Google account is connected. Nothing is ever written to Google
  Analytics.
- The Google **refresh token is stored per brand** in the `brand_integrations`
  table, which has row-level security like every tenant table (see
  [MULTIBRAND.md](./MULTIBRAND.md)). It is **never returned by any API and
  never logged**. Short-lived access tokens are minted in memory, limited to
  `analytics.readonly`.
- The connect flow carries a signed, 15-minute `state` bound to the brand,
  the user and the purpose. A Gmail connect link cannot be replayed here, and
  a GA link cannot be replayed on the Gmail callback. When Google redirects
  back, the server checks again that the user is still active and still
  allowed to manage settings in that brand.
- The callback itself **stores nothing**. Anyone who opens a consent link can
  complete it, so the result is handed to the browser as an encrypted,
  10-minute *connect ticket* in the URL fragment (`#ga_ticket=...`; a
  fragment is never sent to any server, proxy log or `Referer`). The page
  removes it from the address bar at once and redeems it with an
  authenticated `POST /connect`, which only succeeds for the admin who
  started the flow, in the brand it was started for. The ticket is encrypted
  (Fernet) with a key derived from the server's JWT secret, so the refresh
  token inside cannot be read in the browser.
- Errors shown in the UI are written by UtilizeReach. They never contain
  tokens, and they never contain Google's raw error text (which can include
  your Cloud project number).
- **Disconnect** deletes the stored connection and also revokes the token at
  Google. Google revokes the *whole grant* of an OAuth client for that Google
  account, though. So if the same Google account is also connected as a
  sending mailbox (in any brand) or used by another brand's Analytics
  connection, the revoke is skipped and only the stored token is deleted. That
  way sending keeps working. You can always remove access yourself at
  <https://myaccount.google.com/permissions>.

## Troubleshooting

| What you see | Meaning | Fix |
|---|---|---|
| `not_configured` | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are missing (or Google rejects them) | Set them as for Gmail ([EMAIL_SETUP.md](./EMAIL_SETUP.md)) and restart the backend |
| `api_disabled` | The Data or Admin API is not enabled in the OAuth client's Cloud project | Enable **Google Analytics Data API** and **Google Analytics Admin API**, wait a few minutes |
| `permission_denied` | The connected account cannot read that property | Give it Viewer on the property, or pick another property |
| `reconnect_required` | The grant expired or was revoked (Testing-mode tokens expire after 7 days), or analytics access was not granted | Click **Connect** again; publish the consent screen to stop weekly expiry |
| `quota_exceeded` | GA4 quota for the property used up for now | Nothing; cached numbers are shown until the quota resets |
| `invalid_property` | No property picked yet, or it no longer exists | Pick a property in Settings → Integrations |
| `upstream_error` | Google did not answer (timeout, outage), or answered slowly | Try again in a minute |
| "This Google sign-in cannot be finished here" | The connect ticket is older than 10 minutes, or the page was opened by another user or in another brand than the one that clicked Connect | Click **Connect** again, signed in as the admin of that brand |
| A Gmail mailbox connect fails after the same Google account connected Google Analytics | Google returns every scope the account granted to the shared OAuth client; the backend sets `OAUTHLIB_RELAX_TOKEN_SCOPE=1` at startup so the Gmail flow accepts that. Only seen if an operator set it to an empty value | Leave `OAUTHLIB_RELAX_TOKEN_SCOPE` unset (or `1`) |
| Google shows `redirect_uri_mismatch` | The callback URI is not registered, or `PUBLIC_BASE_URL` differs from it | Register the exact URI from step 2 |
| Back in Settings with `ga_error=access_denied` | You cancelled on Google's consent screen | Connect again |
| `ga_error=invalid_state` | The connect link is older than 15 minutes, or the server's JWT secret changed | Connect again |
| `ga_error=not_allowed` | You are no longer an admin of that brand | Ask a brand admin |
| `ga_error=scope_missing` | The analytics permission was unticked | Connect again and allow it |
| `ga_error=no_refresh_token` / `exchange_failed` / `callback_failed` | Google did not complete the sign-in | Connect again; check the backend logs |

## Website analytics page

`GET /api/integrations/google-analytics/report?days=7|28|90` gives the
Website analytics page everything it needs, so nobody has to open Google
Analytics: visits, users, page views and engagement for the period, and the
same numbers for the period before (for the % change); a daily series
(zero-filled); top countries, cities, channels, sources, pages, landing
pages, devices, browsers and operating systems; new vs returning users; the
top events (`page_view`, `click`, `scroll`, `form_start`, ...); and how the
outreach emails drive traffic.

```
{ connected, property_id, property_name, days, range: {start, end}, previous_range, time_zone,
  highlight_source, fetched_at, cached, error?: {code, message},
  totals: {users, new_users, sessions, page_views, engagement_rate, avg_engagement_seconds, events, key_events},
  previous: {same keys}, daily: [{date, users, sessions, page_views}],
  countries, cities, channels, sources, pages, landing_pages, devices, browsers, os, new_vs_returning, events,
  email_ga: {sessions, users, key_events, by_campaign, by_sender},
  email_tracking: {sent, opened, clicked_emails, total_clicks, by_campaign, by_sender, daily},
  notes: [string] }
```

**Two sources for email traffic, shown side by side.**

- `email_ga`: GA sessions whose session source is the brand's outreach
  source (as in the Dashboard panel), by `utm_campaign` and `utm_term`.
- `email_tracking`: UtilizeReach's own numbers from `sent_emails` and
  `email_clicks` for the same dates: emails sent, opened and clicked in the
  period, total clicks, by campaign, by sender (persona name, else the
  mailbox name before the `@`) and per day. Internal test sends
  (`variant = 'TEST'`) are left out. Opens and clicks of bounced emails are
  not counted (they come from scanners). A clicked email is counted once,
  on the day of its first click in the period.

The website's cookie banner means GA only sees visitors who accept cookies,
so `email_ga` is usually lower than `email_tracking`. Our own click tracking
is the reliable number for email clicks; GA shows what those visitors did on
the site. The page explains this in one plain sentence next to the two email
cards. `notes` only carries what the page cannot tell by itself (no outreach
source set, recent days can still change, email numbers failed to load);
"connect Google Analytics" comes from `error.code`.

How it works:

- 16 GA reports (13 without an outreach source) are sent with
  `batchRunReports`, 5 per batch, with the batches running in parallel on
  the GA thread pool. The totals use two date ranges (current and previous).
- The period is the last N complete days, ending yesterday (like GA's own
  "Last N days"), and the previous period is the N days before it, so the %
  change compares whole days. Today is shown by the LIVE strip.
- Dates follow the GA property's time zone. `email_tracking` uses the same
  calendar days in that zone (UTC when GA is not connected).
- The GA part is cached for 5 minutes per brand, property, period and
  source, with the same error handling as `/summary`. `email_tracking` is
  read from the database off the event loop (default thread pool, brand
  context copied) and cached for 60 seconds per brand, dates and time zone.
- `email_tracking` is always filled, even when GA is not connected, fails, or
  is hidden from the Dashboard. *Show on Dashboard* off hides only the GA
  sections from users without `settings.manage`.

## API reference

All under `/api/integrations/google-analytics`, scoped to the caller's active
brand.

| Method & path | Permission | Result |
|---|---|---|
| `GET /status` | analytics.view | `{configured, connected, status, account_email, property_id, property_name, highlight_source, default_highlight_source, show_on_dashboard, last_error, can_manage, redirect_uri?}` |
| `GET /auth` | settings.manage | `{auth_url}`: send the browser there |
| `GET /callback` | public (Google redirects here) | stores nothing; redirect to `/settings/integrations?ga=confirm#ga_ticket=<ticket>` or `?ga_error=<code>` |
| `POST /connect` | settings.manage | body `{ticket}`; only the user who started the flow, in that brand, within 10 minutes → saves the connection, returns the status |
| `GET /properties` | settings.manage | `{properties: [{property_id, display_name, account_name}]}` |
| `PUT /settings` | settings.manage | body `{property_id?, property_name?, highlight_source?, show_on_dashboard?}` (`property_id` digits only; `""` clears; `highlight_source: ""` restores the default) → status |
| `DELETE /` | settings.manage | `{ok: true}` |
| `GET /realtime` | analytics.view | `{connected, property_id, active_users, per_minute[30], top_pages, countries, devices, fetched_at, cached, error?}` |
| `GET /summary?days=7` | analytics.view | `{connected, property_id, days, highlight_source, totals, sources, email{totals, by_campaign, by_sender, daily, landing_pages}, fetched_at, cached, error?}` |
| `GET /report?days=28` | analytics.view | `days` = 7, 28 or 90 (default 28). See [Website analytics page](#website-analytics-page) |

`/realtime`, `/summary` and `/report` always answer `200` with an `error: {code, message}`
object when the data cannot be fetched, so the Dashboard can explain why.
`/properties`, `/auth`, `/connect` and `/settings` answer with an HTTP error
and a readable `detail` message.

Code: `backend/integrations/google_analytics.py` (provider: OAuth, GA API
calls, parsing, error mapping, cache) and
`backend/api/routers/integrations_google_analytics.py` (endpoints and the
stored per-brand connection). Unit tests:
`backend/tests/test_google_analytics.py`.
