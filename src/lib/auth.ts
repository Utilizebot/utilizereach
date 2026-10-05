/**
 * Auth Client
 *
 * JWT-based authentication against the FastAPI backend (/api/auth/*).
 * Token is stored in localStorage under 'auth_token'.
 * Replaces the old Supabase Auth integration.
 *
 * Multi-brand: the JWT carries a `brand` claim (the brand the session acts
 * in). Switching brand = POST /api/brands/switch -> a NEW token -> full page
 * reload, so no component keeps state that belongs to the previous brand.
 */

import type { SalesRep } from '../types/scraper';

export const AUTH_TOKEN_KEY = 'auth_token';

/**
 * Local replacement for the old @supabase/supabase-js User type.
 * Only the fields the app actually uses.
 */
export interface AuthUser {
  id: string;
  email: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user: SalesRep;
}

/**
 * Get the stored auth token (or null if not logged in)
 */
export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Store the auth token
 */
export function setStoredToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  notifyTokenChanged();
}

/**
 * Clear the auth token
 */
export function clearStoredToken(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
  notifyTokenChanged();
}

/**
 * Same-tab notification that the stored token changed (login / logout /
 * brand switch). The browser `storage` event only fires in OTHER tabs.
 */
export const AUTH_TOKEN_EVENT = 'auth:token-changed';
function notifyTokenChanged(): void {
  try {
    window.dispatchEvent(new Event(AUTH_TOKEN_EVENT));
  } catch {
    /* no DOM */
  }
}

/**
 * Build Authorization headers for authenticated requests
 */
export function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Decode the (unverified) claims of a JWT. Used only for client-side
 * bookkeeping (which user / brand a token belongs to) - never for security.
 */
export function decodeTokenClaims(token: string | null): { sub?: string; brand?: string } | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/**
 * Append ?token=<jwt> to a URL. ONLY for Server-Sent-Events endpoints: the
 * browser EventSource API cannot send an Authorization header, so the backend
 * SSE routes accept the token as a query parameter
 * (api/dependencies.get_current_user_from_query).
 */
export function withAuthToken(url: string): string {
  const token = getStoredToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// Global fetch interceptor
// ---------------------------------------------------------------------------

let originalFetch: typeof window.fetch | null = null;
let redirectingToLogin = false;

/** Origins our backend is served from (same origin + optional VITE_API_URL). */
function apiOrigins(): Set<string> {
  const origins = new Set<string>([window.location.origin]);
  try {
    const envUrl = import.meta.env.VITE_API_URL as string | undefined;
    if (envUrl) origins.add(new URL(envUrl, window.location.origin).origin);
  } catch {
    /* ignore malformed env */
  }
  return origins;
}

/**
 * True for requests to OUR backend's /api/* routes. The token is never
 * attached to third-party URLs (a JWT must not leak to another origin just
 * because its path happens to contain "/api/").
 */
function isOwnApiUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl, window.location.href);
    return apiOrigins().has(u.origin) && u.pathname.includes('/api/');
  } catch {
    return false;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return String(input);
}

function goToLogin(): void {
  if (redirectingToLogin) return;
  if (window.location.pathname === '/login') return;
  redirectingToLogin = true;
  clearStoredToken();
  window.location.assign('/login');
}

/**
 * Install a one-time global fetch interceptor.
 *
 * The app's pages call fetch() directly (not a shared client), so rather than
 * wire the Authorization header into dozens of call sites, we attach the stored
 * JWT to every request to our own `/api` routes here. Public endpoints (login,
 * tracking, unsubscribe) simply ignore the header, so adding it is safe. An
 * explicit Authorization header set by the caller is never overwritten.
 *
 * It also centralises session expiry: a 401 from an API call that carried our
 * token clears it and bounces to /login. (403 = permission denied is left for
 * the page to show. A 401 on a request sent WITHOUT a token - e.g. an anonymous
 * visitor on a public page - does not redirect.)
 *
 * Also keeps tabs consistent: if another tab logs out, logs in as someone else
 * or switches brand, this tab reloads so it never keeps showing (or writing
 * into) the previous brand while its requests already act in the new one.
 */
export function installAuthFetch(): void {
  const w = window as unknown as { __authFetchInstalled?: boolean };
  if (w.__authFetchInstalled) return;
  w.__authFetchInstalled = true;

  const orig = window.fetch.bind(window);
  originalFetch = orig;

  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    let isApi = false;
    let sentOurToken = false;
    let isLoginCall = false;
    try {
      const url = requestUrl(input);
      isApi = isOwnApiUrl(url);
      isLoginCall = isApi && /\/api\/auth\/login\b/.test(url);
      const token = getStoredToken();
      if (isApi && token) {
        const headers = new Headers(
          init.headers ??
            (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined)
        );
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${token}`);
          init = { ...init, headers };
          sentOurToken = true;
        } else {
          sentOurToken = headers.get('Authorization') === `Bearer ${token}`;
        }
      }
    } catch {
      /* fall through to a plain fetch */
    }

    const res = await orig(input as RequestInfo | URL, init);

    try {
      if (isApi && sentOurToken && !isLoginCall && res.status === 401) {
        goToLogin();
      }
    } catch {
      /* ignore */
    }
    return res;
  };

  // Cross-tab session / brand consistency.
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key === null) {
      // storage.clear() in another tab: reload so route guards re-evaluate
      window.location.reload();
      return;
    }
    if (e.key !== AUTH_TOKEN_KEY) return;
    const before = decodeTokenClaims(e.oldValue ?? null);
    const after = decodeTokenClaims(e.newValue ?? null);
    if (!after) {
      // logged out elsewhere
      if (before && window.location.pathname !== '/login') window.location.assign('/login');
      return;
    }
    if (!before || before.sub !== after.sub || before.brand !== after.brand) {
      window.location.reload();
    }
  });
}

/**
 * fetch() that still attaches our token but never triggers the global
 * 401 -> /login redirect. For best-effort background calls made on pages that
 * may be public (e.g. loading the active brand's branding).
 */
export async function fetchWithoutAuthRedirect(url: string, init: RequestInit = {}): Promise<Response> {
  const f = originalFetch ?? window.fetch.bind(window);
  const headers = new Headers(init.headers);
  const token = getStoredToken();
  if (token && !headers.has('Authorization') && isOwnApiUrl(url)) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return f(url, { ...init, headers });
}

async function parseError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => ({ detail: response.statusText }));
  return new Error(body.detail || `Request failed: ${response.status}`);
}

/**
 * Log in with email/password. Stores the JWT on success.
 */
export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  const data: LoginResponse = await response.json();
  setStoredToken(data.access_token);
  return data;
}

/**
 * Register a new user (bootstrap admin or admin-created rep).
 * Stores the JWT on success (auto-login).
 */
export async function register(
  email: string,
  password: string,
  fullName: string,
  role?: string
): Promise<LoginResponse> {
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ email, password, full_name: fullName, ...(role ? { role } : {}) }),
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  const data: LoginResponse = await response.json();
  setStoredToken(data.access_token);
  return data;
}

/**
 * Log out: clear the stored token (stateless JWT — nothing server-side to do)
 */
export function logout(): void {
  clearStoredToken();
}

// Concurrent /api/auth/me calls (ProtectedRoute + layout + page each mount a
// useAuth) share one in-flight request for the same token.
let meInFlight: { token: string | null; promise: Promise<SalesRep> } | null = null;

/**
 * Get the current user's sales_reps profile, including the active brand,
 * the user's brands[] and permissions[] (see docs/MULTIBRAND.md).
 * Throws on 401 (caller should clear the token).
 */
export async function getMe(): Promise<SalesRep> {
  const token = getStoredToken();
  if (meInFlight && meInFlight.token === token) {
    return meInFlight.promise;
  }
  const promise = (async () => {
    const response = await fetch('/api/auth/me', {
      headers: { ...authHeaders() },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Unauthorized');
      }
      throw await parseError(response);
    }

    return (await response.json()) as SalesRep;
  })();
  const entry = { token, promise };
  meInFlight = entry;
  const clear = () => {
    if (meInFlight === entry) meInFlight = null;
  };
  promise.then(clear, clear);
  return promise;
}

/**
 * Update the current user's profile
 */
export async function updateMe(updates: Partial<SalesRep>): Promise<SalesRep> {
  const response = await fetch('/api/auth/me', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json();
}

/**
 * Change the current user's password
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean }> {
  const response = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json();
}

/**
 * Switch the active brand. The backend re-checks membership and returns a new
 * token whose `brand` claim names the target brand; it is stored here. The
 * caller must then do a FULL page reload (see useAuth().switchBrand).
 */
export async function switchBrand(brandId: string): Promise<LoginResponse> {
  const response = await fetch('/api/brands/switch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ brand_id: brandId }),
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  const data: LoginResponse = await response.json();
  if (!data?.access_token) {
    throw new Error('Brand switch failed: no token returned');
  }
  setStoredToken(data.access_token);
  return data;
}

/**
 * Check whether an admin account exists (used by the setup wizard; unauthenticated)
 */
export async function getAuthStatus(): Promise<{ adminExists: boolean }> {
  const response = await fetch('/api/auth/status');
  if (!response.ok) {
    throw await parseError(response);
  }
  return response.json();
}

/**
 * Build the AuthUser shape from a sales rep row
 */
export function userFromSalesRep(rep: SalesRep): AuthUser {
  return {
    id: rep.auth_user_id || rep.id,
    email: rep.email,
  };
}
