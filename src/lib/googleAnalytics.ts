/**
 * Google Analytics 4 integration - typed API client.
 *
 * Talks to the per-brand backend at /api/integrations/google-analytics
 * (everything is scoped to the caller's ACTIVE brand server-side; the JWT is
 * attached by the global fetch interceptor in lib/auth.ts).
 *
 * The Google refresh token never leaves the server: no endpoint returns it,
 * so nothing here ever sees one.
 *
 * Responses are normalised defensively (missing arrays -> [], numbers coerced,
 * the realtime per-minute series always 30 zero-filled points) so a partial
 * or older backend can never crash the dashboard.
 */

const API_BASE = import.meta.env.VITE_API_URL || '';

/** Base path of the integration's API. */
export const GA_API_PATH = '/api/integrations/google-analytics';
const GA_BASE = `${API_BASE}${GA_API_PATH}`;

/** Settings page that hosts the Google Analytics card. */
export const GA_SETTINGS_PATH = '/settings/integrations';

/** Where server admins find the setup guide (shown as text, not a link). */
export const GA_DOCS_PATH = 'docs/GOOGLE_ANALYTICS.md';

// ---------------------------------------------------------------------------
// Types (mirror the backend contract)
// ---------------------------------------------------------------------------

export type GaConnectionState = 'connected' | 'reconnect_required' | 'not_connected';

export type GaErrorCode =
  | 'not_connected'
  | 'not_configured'
  | 'api_disabled'
  | 'permission_denied'
  | 'reconnect_required'
  | 'quota_exceeded'
  | 'invalid_property'
  | 'upstream_error';

export interface GaError {
  /** One of GaErrorCode; kept as string so unknown codes from a newer backend still render. */
  code: GaErrorCode | string;
  message: string;
}

export interface GaStatus {
  /** The server has Google OAuth credentials configured. */
  configured: boolean;
  connected: boolean;
  status: GaConnectionState;
  account_email: string | null;
  property_id: string | null;
  property_name: string | null;
  /** utm_source counted as "from your outreach emails" (brand default when unset). */
  highlight_source: string | null;
  /** The brand's default outreach utm_source (used when highlight_source is cleared). */
  default_highlight_source: string | null;
  show_on_dashboard: boolean;
  /** Last lasting problem, already phrased for people (never contains a token). */
  last_error: string | null;
  can_manage: boolean;
  /** "Authorized redirect URI" to register in Google Cloud (only sent to admins). */
  redirect_uri: string | null;
}

export interface GaProperty {
  property_id: string;
  display_name: string;
  account_name: string;
}

export interface GaSettingsUpdate {
  property_id?: string;
  property_name?: string;
  highlight_source?: string;
  show_on_dashboard?: boolean;
}

export interface GaNamedCount {
  name: string;
  users: number;
}

export interface GaMinute {
  minutes_ago: number;
  users: number;
}

export interface GaRealtime {
  connected: boolean;
  property_id: string | null;
  active_users: number;
  /** Always 30 points, minutes_ago 0..29, zero-filled, sorted newest first. */
  per_minute: GaMinute[];
  top_pages: GaNamedCount[];
  countries: GaNamedCount[];
  devices: GaNamedCount[];
  fetched_at: string | null;
  cached: boolean;
  error?: GaError;
}

export interface GaTrafficSource {
  source: string;
  medium: string;
  sessions: number;
  users: number;
}

export interface GaEmailBreakdown {
  sessions: number;
  users: number;
  key_events: number;
}

export interface GaCampaignRow extends GaEmailBreakdown {
  campaign: string;
}

export interface GaSenderRow extends GaEmailBreakdown {
  sender: string;
}

export interface GaSummary {
  connected: boolean;
  property_id: string | null;
  days: number;
  highlight_source: string | null;
  totals: {
    sessions: number;
    users: number;
    key_events: number;
    engagement_rate: number;
  };
  sources: GaTrafficSource[];
  email: {
    totals: GaEmailBreakdown;
    by_campaign: GaCampaignRow[];
    by_sender: GaSenderRow[];
    daily: { date: string; sessions: number }[];
    landing_pages: { page: string; sessions: number }[];
  };
  fetched_at: string | null;
  cached: boolean;
  error?: GaError;
}

/** Day ranges the backend accepts for /summary. */
export const GA_SUMMARY_DAYS = [1, 7, 28, 30, 90] as const;
export type GaSummaryDays = (typeof GA_SUMMARY_DAYS)[number];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown for non-2xx responses. `code` is set when the backend sent one. */
export class GaApiError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'GaApiError';
    this.status = status;
    this.code = code;
  }
}

/** Friendly copy for every error code the integration can surface. */
const ERROR_MESSAGES: Record<string, string> = {
  // Contract error codes
  not_connected: 'Google Analytics is not connected for this brand yet.',
  not_configured:
    'Google sign-in is not set up on this server yet. A server admin needs to configure the Google OAuth client first.',
  api_disabled:
    'The Google Analytics APIs are not enabled for this server’s Google Cloud project. An admin needs to enable "Google Analytics Data API" and "Google Analytics Admin API" in Google Cloud Console, then try again.',
  permission_denied:
    'The connected Google account does not have access to this Google Analytics property. Pick another property or reconnect with an account that can view it.',
  reconnect_required:
    'Google access expired or was revoked. Reconnect Google Analytics to keep the live stats flowing.',
  quota_exceeded:
    'Google Analytics rate limit reached for now. Stats will refresh automatically in a few minutes.',
  invalid_property: 'That Google Analytics property could not be found. Pick a property again.',
  upstream_error: 'Google Analytics did not respond as expected. Please try again in a moment.',
  // OAuth round-trip codes (?ga_error=...)
  access_denied: 'Google sign-in was cancelled, so nothing was connected.',
  invalid_state: 'The connect link expired. Please start the connection again.',
  not_allowed: 'You no longer have permission to manage integrations for this brand.',
  no_code: 'Google did not complete the sign-in. Please try again.',
  callback_failed: 'Google sign-in could not be completed. Please try again.',
  token_exchange_failed: 'Google sign-in could not be completed. Please try again.',
  no_refresh_token:
    'Google did not grant offline access. Please connect again and approve all requested permissions.',
  scope_missing:
    'Google did not grant read access to Analytics. Please connect again and tick the box that allows viewing your Google Analytics data.',
  exchange_failed: 'Google sign-in could not be completed. Please try again.',
  oauth_error: 'Google reported a problem during sign-in. Please try again.',
};

/**
 * Best guess at the error code of a response that carried only a message
 * (FastAPI `detail` string). Only used to pick follow-up behaviour; the
 * server's own message is still what the user sees.
 */
function inferCode(status: number, message: string): string | null {
  if (status === 409) return 'reconnect_required';
  if (status === 429) return 'quota_exceeded';
  if (status === 502 || status === 503 || status === 504) return 'upstream_error';
  const m = message.toLowerCase();
  if (m.includes('analytics data api') || m.includes('analytics admin api')) return 'api_disabled';
  if (m.includes('not configured on this server')) return 'not_configured';
  if (m.includes('expired or was revoked')) return 'reconnect_required';
  if (status === 403 && m.includes('analytics property')) return 'permission_denied';
  return null;
}

/** Only short [a-z0-9_] codes are echoed back to the user. */
export function sanitizeErrorCode(raw: string | null | undefined): string {
  return (raw || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 48);
}

/** Human message for an error code (unknown codes get a generic message). */
export function gaErrorMessage(code: string | null | undefined, fallback?: string | null): string {
  const c = sanitizeErrorCode(code);
  if (c && ERROR_MESSAGES[c]) return ERROR_MESSAGES[c];
  if (fallback) return fallback;
  return c
    ? `Google Analytics request failed (${c}). Please try again.`
    : 'Google Analytics request failed. Please try again.';
}

/** Codes that mean "the connection itself needs attention" (refresh /status). */
export function isConnectionError(code: string | null | undefined): boolean {
  return (
    code === 'reconnect_required' ||
    code === 'not_connected' ||
    code === 'not_configured' ||
    code === 'invalid_property' ||
    code === 'permission_denied'
  );
}

async function toApiError(res: Response, fallback: string): Promise<GaApiError> {
  let message = fallback;
  let code: string | null = null;
  try {
    const body = await res.json();
    const detail = body?.detail ?? body?.error ?? body;
    if (typeof detail === 'string') {
      // A bare code ("api_disabled") or "code: message" is mapped to friendly copy.
      const m = /^([a-z_]{3,48})(?::\s*(.*))?$/s.exec(detail.trim());
      if (m && ERROR_MESSAGES[m[1]]) {
        code = m[1];
        message = m[2]?.trim() || gaErrorMessage(code);
      } else {
        message = detail;
      }
    } else if (Array.isArray(detail)) {
      // FastAPI validation errors: [{ msg, loc, ... }]
      const msgs = detail.map((d) => (typeof d?.msg === 'string' ? d.msg : '')).filter(Boolean);
      if (msgs.length) message = msgs.join('; ');
    } else if (detail && typeof detail === 'object') {
      if (typeof detail.code === 'string') code = sanitizeErrorCode(detail.code);
      if (typeof detail.message === 'string' && detail.message) message = detail.message;
      else if (code) message = gaErrorMessage(code);
    }
  } catch {
    /* non-JSON body */
  }
  if (!code && message !== fallback) code = inferCode(res.status, message);
  if (!code && res.status >= 500) code = 'upstream_error';
  if (res.status === 403 && message === fallback) {
    message = 'You do not have permission to do this for the active brand.';
  }
  return new GaApiError(message, res.status, code);
}

async function request<T>(path: string, init: RequestInit = {}, fallback = 'Request failed'): Promise<T> {
  const res = await fetch(`${GA_BASE}${path}`, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw await toApiError(res, fallback);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Normalisers
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown> | null | undefined;

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function arr(v: unknown): Raw[] {
  return Array.isArray(v) ? (v as Raw[]) : [];
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function normError(v: unknown): GaError | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') return { code: sanitizeErrorCode(v) || 'upstream_error', message: gaErrorMessage(v) };
  const o = obj(v);
  const code = sanitizeErrorCode(str(o.code)) || 'upstream_error';
  return { code, message: str(o.message) || gaErrorMessage(code) };
}

function normNamed(list: unknown): GaNamedCount[] {
  return arr(list).map((r) => ({ name: str(r?.name) || '(not set)', users: num(r?.users) }));
}

export function normalizeStatus(raw: Raw): GaStatus {
  const o = obj(raw);
  const connected = !!o.connected;
  const rawState = str(o.status);
  const status: GaConnectionState =
    rawState === 'connected' || rawState === 'reconnect_required' || rawState === 'not_connected'
      ? rawState
      : connected
        ? 'connected'
        : 'not_connected';
  return {
    configured: o.configured !== false,
    connected,
    status,
    account_email: strOrNull(o.account_email),
    property_id: strOrNull(o.property_id),
    property_name: strOrNull(o.property_name),
    highlight_source: strOrNull(o.highlight_source),
    default_highlight_source: strOrNull(o.default_highlight_source),
    show_on_dashboard: o.show_on_dashboard !== false,
    last_error: strOrNull(o.last_error),
    can_manage: !!o.can_manage,
    redirect_uri: strOrNull(o.redirect_uri),
  };
}

/** 30 points, minutes_ago 0..29 (zero-filled), newest first. */
function normPerMinute(list: unknown): GaMinute[] {
  const byMinute = new Map<number, number>();
  for (const r of arr(list)) {
    const m = Math.round(num(r?.minutes_ago));
    if (m >= 0 && m < 30) byMinute.set(m, (byMinute.get(m) || 0) + num(r?.users));
  }
  return Array.from({ length: 30 }, (_, m) => ({ minutes_ago: m, users: byMinute.get(m) || 0 }));
}

export function normalizeRealtime(raw: Raw): GaRealtime {
  const o = obj(raw);
  return {
    connected: !!o.connected,
    property_id: strOrNull(o.property_id),
    active_users: num(o.active_users),
    per_minute: normPerMinute(o.per_minute),
    top_pages: normNamed(o.top_pages),
    countries: normNamed(o.countries),
    devices: normNamed(o.devices),
    fetched_at: strOrNull(o.fetched_at),
    cached: !!o.cached,
    error: normError(o.error),
  };
}

function normBreakdown(v: unknown): GaEmailBreakdown {
  const o = obj(v);
  return { sessions: num(o.sessions), users: num(o.users), key_events: num(o.key_events) };
}

export function normalizeSummary(raw: Raw): GaSummary {
  const o = obj(raw);
  const totals = obj(o.totals);
  const email = obj(o.email);
  return {
    connected: !!o.connected,
    property_id: strOrNull(o.property_id),
    days: num(o.days) || 7,
    highlight_source: strOrNull(o.highlight_source),
    totals: {
      sessions: num(totals.sessions),
      users: num(totals.users),
      key_events: num(totals.key_events),
      engagement_rate: num(totals.engagement_rate),
    },
    sources: arr(o.sources).map((r) => ({
      source: str(r?.source) || '(direct)',
      medium: str(r?.medium) || '(none)',
      sessions: num(r?.sessions),
      users: num(r?.users),
    })),
    email: {
      totals: normBreakdown(email.totals),
      by_campaign: arr(email.by_campaign).map((r) => ({
        campaign: str(r?.campaign) || '(not set)',
        ...normBreakdown(r),
      })),
      by_sender: arr(email.by_sender).map((r) => ({
        sender: str(r?.sender) || '(not set)',
        ...normBreakdown(r),
      })),
      daily: arr(email.daily)
        .map((r) => ({ date: str(r?.date), sessions: num(r?.sessions) }))
        .filter((d) => d.date)
        .sort((a, b) => a.date.localeCompare(b.date)),
      landing_pages: arr(email.landing_pages).map((r) => ({
        page: str(r?.page) || '(not set)',
        sessions: num(r?.sessions),
      })),
    },
    fetched_at: strOrNull(o.fetched_at),
    cached: !!o.cached,
    error: normError(o.error),
  };
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** GET /status - connection + settings for the active brand (analytics.view). */
export async function getGaStatus(signal?: AbortSignal): Promise<GaStatus> {
  const raw = await request<Raw>('/status', { signal }, 'Could not load Google Analytics status');
  return normalizeStatus(raw);
}

/** GET /auth - Google consent URL (settings.manage). Navigate the browser to it. */
export async function getGaAuthUrl(): Promise<string> {
  const data = await request<{ auth_url?: string }>('/auth', {}, 'Could not start the Google sign-in');
  if (!data?.auth_url) throw new GaApiError('No sign-in URL was returned by the server.', 500);
  return data.auth_url;
}

/**
 * POST /connect - finish a Google sign-in (settings.manage). The callback
 * hands the browser an encrypted one-time ticket in the URL fragment; only
 * the admin who started the sign-in, in the same brand, can redeem it.
 */
export async function confirmGaConnection(ticket: string): Promise<GaStatus> {
  const raw = await request<Raw>(
    '/connect',
    { method: 'POST', body: JSON.stringify({ ticket }) },
    'Could not finish connecting Google Analytics'
  );
  return normalizeStatus(raw);
}

/** GET /properties - GA4 properties the connected account can read (settings.manage). */
export async function listGaProperties(signal?: AbortSignal): Promise<GaProperty[]> {
  const data = await request<{ properties?: unknown }>(
    '/properties',
    { signal },
    'Could not load your Google Analytics properties'
  );
  return arr(data?.properties)
    .map((p) => ({
      property_id: str(p?.property_id),
      display_name: str(p?.display_name) || `Property ${str(p?.property_id)}`,
      account_name: str(p?.account_name),
    }))
    .filter((p) => /^[0-9]{1,20}$/.test(p.property_id));
}

/** PUT /settings - update property / highlight source / dashboard toggle (settings.manage). */
export async function updateGaSettings(body: GaSettingsUpdate): Promise<GaStatus> {
  const raw = await request<Raw>(
    '/settings',
    { method: 'PUT', body: JSON.stringify(body) },
    'Could not save Google Analytics settings'
  );
  return normalizeStatus(raw);
}

/** DELETE / - revoke Google access and remove the brand's connection (settings.manage). */
export async function disconnectGa(): Promise<void> {
  await request<unknown>('/', { method: 'DELETE' }, 'Could not disconnect Google Analytics');
}

/** GET /realtime - active users now + last 30 minutes (analytics.view). */
export async function getGaRealtime(signal?: AbortSignal): Promise<GaRealtime> {
  const raw = await request<Raw>('/realtime', { signal }, 'Could not load live website stats');
  return normalizeRealtime(raw);
}

/** GET /summary?days=N - site + outreach-email traffic for the last N days (analytics.view). */
export async function getGaSummary(days: GaSummaryDays, signal?: AbortSignal): Promise<GaSummary> {
  const raw = await request<Raw>(
    `/summary?days=${encodeURIComponent(String(days))}`,
    { signal },
    'Could not load website traffic summary'
  );
  return normalizeSummary(raw);
}

/** True for a fetch aborted by an AbortController (not a real failure). */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
