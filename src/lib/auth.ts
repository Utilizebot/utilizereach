/**
 * Auth Client
 *
 * JWT-based authentication against the FastAPI backend (/api/auth/*).
 * Token is stored in localStorage under 'auth_token'.
 * Replaces the old Supabase Auth integration.
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
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

/**
 * Store the auth token
 */
export function setStoredToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

/**
 * Clear the auth token
 */
export function clearStoredToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

/**
 * Build Authorization headers for authenticated requests
 */
export function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Install a one-time global fetch interceptor.
 *
 * The app's pages call fetch() directly (not a shared client), so rather than
 * wire the Authorization header into dozens of call sites, we attach the stored
 * JWT to every same-app `/api` request here. Public endpoints (login, tracking,
 * unsubscribe) simply ignore the header, so adding it unconditionally is safe.
 *
 * It also centralises session expiry: a 401 from an API call clears the token
 * and bounces to /login. (403 = permission denied is left for the page to show.)
 */
export function installAuthFetch(): void {
  const w = window as unknown as { __authFetchInstalled?: boolean };
  if (w.__authFetchInstalled) return;
  w.__authFetchInstalled = true;

  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    let isApi = false;
    try {
      const url =
        typeof input === 'string' ? input
          : input instanceof URL ? input.href
            : input instanceof Request ? input.url
              : String(input);
      isApi = url.includes('/api/');
      const token = getStoredToken();
      if (isApi && token) {
        const headers = new Headers(
          init.headers ?? (input instanceof Request ? input.headers : undefined)
        );
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${token}`);
          init = { ...init, headers };
        }
      }
    } catch {
      /* fall through to a plain fetch */
    }

    const res = await orig(input as RequestInfo | URL, init);

    try {
      if (isApi && res.status === 401 && window.location.pathname !== '/login') {
        clearStoredToken();
        window.location.assign('/login');
      }
    } catch {
      /* ignore */
    }
    return res;
  };
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

/**
 * Get the current user's sales_reps profile.
 * Throws on 401 (caller should clear the token).
 */
export async function getMe(): Promise<SalesRep> {
  const response = await fetch('/api/auth/me', {
    headers: { ...authHeaders() },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Unauthorized');
    }
    throw await parseError(response);
  }

  return response.json();
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
