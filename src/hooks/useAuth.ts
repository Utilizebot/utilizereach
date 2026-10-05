/**
 * useAuth Hook - Authentication Utilities
 *
 * Provides authentication state and functions for the application.
 * Backed by the FastAPI JWT auth endpoints (/api/auth/*).
 * Token lives in localStorage under 'auth_token'.
 *
 * Multi-brand (docs/MULTIBRAND.md): /api/auth/me also returns the ACTIVE
 * brand, the user's brands[], their permissions[] in the active brand and
 * whether they are a platform admin. Roles are per brand.
 *
 *   const { brands, activeBrand, isPlatformAdmin, permissions, can, switchBrand } = useAuth();
 *
 * Phase: 1.6 - Authentication Enhancement
 * Created: 2025-10-16
 * Updated: 2026-08-12 - Migrated off Supabase to backend JWT auth
 * Updated: 2026-10    - Multi-brand: brands, activeBrand, permissions, switchBrand
 */

import { useState, useEffect } from 'react';
import {
  login as apiLogin,
  logout as apiLogout,
  switchBrand as apiSwitchBrand,
  getMe,
  updateMe,
  getStoredToken,
  clearStoredToken,
  userFromSalesRep,
} from '../lib/auth';
import type { AuthUser } from '../lib/auth';
import type { ActiveBrand, BrandMembership, BrandRole, SalesRep } from '../types/scraper';

interface AuthState {
  // Authenticated user (from backend JWT auth)
  user: AuthUser | null;

  // Sales rep data from sales_reps table (+ active-brand context)
  salesRep: SalesRep | null;

  // Loading states
  loading: boolean;
  initializing: boolean;

  // Helper flags
  isAuthenticated: boolean;
  /** Admin of the ACTIVE brand, or a platform admin. */
  isAdmin: boolean;
  isSalesRep: boolean;

  // Multi-brand
  /** Brands the user can act in. */
  brands: BrandMembership[];
  /** The brand this session acts in (null until loaded / older backend). */
  activeBrand: ActiveBrand | null;
  /** May create / configure brands and act in any brand. */
  isPlatformAdmin: boolean;
  /** Effective permissions in the active brand (resolved server-side). */
  permissions: string[];
  /** True if the user holds `permission` in the active brand (platform admins always pass). */
  can: (permission: string) => boolean;
}

interface AuthActions {
  // Sign in
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;

  // Sign out
  signOut: () => Promise<void>;

  // Refresh user data
  refreshUser: () => Promise<void>;

  // Update sales rep profile
  updateProfile: (updates: Partial<SalesRep>) => Promise<{ error: Error | null }>;

  /**
   * Switch the active brand: POST /api/brands/switch, store the new token,
   * then FULL page reload (so no state from the previous brand survives).
   * Resolves with an error only if the switch failed (no reload then).
   */
  switchBrand: (brandId: string) => Promise<{ error: Error | null }>;
}

const BRAND_ROLES: readonly BrandRole[] = ['admin', 'manager', 'member', 'viewer'];

function toBrandRole(role: string | null | undefined): BrandRole {
  const r = (role || '').toLowerCase();
  if (r === 'sales_rep') return 'member';
  return (BRAND_ROLES as readonly string[]).includes(r) ? (r as BrandRole) : 'viewer';
}

/** Permissions that only platform admins hold (mirrors api/permissions.py). */
const PLATFORM_PERMISSIONS = new Set(['brands.manage', 'brands.view_all']);

/**
 * Path to land on after a brand switch: the same section, minus any
 * record id (a campaign / lead id belongs to the previous brand).
 */
function landingPathAfterSwitch(): string {
  const idLike = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i;
  const segments = window.location.pathname.split('/').filter(Boolean);
  const kept: string[] = [];
  for (const seg of segments) {
    if (idLike.test(seg)) break;
    kept.push(seg);
  }
  const path = '/' + kept.join('/');
  return path === '/' || path === '/login' ? '/dashboard' : path;
}

/**
 * Custom hook for authentication
 *
 * Usage:
 * const { user, salesRep, isAdmin, signIn, signOut } = useAuth();
 */
export function useAuth(): AuthState & AuthActions {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [salesRep, setSalesRep] = useState<SalesRep | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);

  // Initialize auth state from stored token
  useEffect(() => {
    let cancelled = false;

    const initAuth = async () => {
      const token = getStoredToken();
      if (!token) {
        setInitializing(false);
        return;
      }

      try {
        const rep = await getMe();
        if (!cancelled) {
          setSalesRep(rep);
          setUser(userFromSalesRep(rep));
        }
      } catch {
        // Invalid/expired token - clear it
        clearStoredToken();
        if (!cancelled) {
          setUser(null);
          setSalesRep(null);
        }
      } finally {
        if (!cancelled) {
          setInitializing(false);
        }
      }
    };

    initAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  // Sign in function
  const signIn = async (email: string, password: string) => {
    setLoading(true);
    try {
      const { user: rep } = await apiLogin(email, password);
      setSalesRep(rep);
      setUser(userFromSalesRep(rep));
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    } finally {
      setLoading(false);
    }
  };

  // Sign out function
  const signOut = async () => {
    setLoading(true);
    try {
      apiLogout();
      setUser(null);
      setSalesRep(null);
    } catch (error) {
      console.error('Error signing out:', error);
    } finally {
      setLoading(false);
    }
  };

  // Refresh user data
  const refreshUser = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const rep = await getMe();
      setSalesRep(rep);
      setUser(userFromSalesRep(rep));
    } catch (error) {
      console.error('Error refreshing user:', error);
    } finally {
      setLoading(false);
    }
  };

  // Update sales rep profile
  const updateProfile = async (updates: Partial<SalesRep>) => {
    if (!salesRep) {
      return { error: new Error('No sales rep record found') };
    }

    setLoading(true);
    try {
      const rep = await updateMe(updates);
      // PATCH /me may return the bare profile row; keep the brand context
      // (brands / permissions / active brand) we already have.
      const merged: SalesRep = {
        ...rep,
        brand_id: rep.brand_id ?? salesRep.brand_id,
        brand_slug: rep.brand_slug ?? salesRep.brand_slug,
        brand_name: rep.brand_name ?? salesRep.brand_name,
        brand_role: rep.brand_role ?? salesRep.brand_role,
        // a bare profile row carries the GLOBAL role; keep the brand role
        role: (rep.brand_role || rep.brand_id) ? rep.role : salesRep.role,
        is_platform_admin: rep.is_platform_admin ?? salesRep.is_platform_admin,
        brands: rep.brands ?? salesRep.brands,
        permissions: rep.permissions ?? salesRep.permissions,
      };
      setSalesRep(merged);
      setUser(userFromSalesRep(merged));
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    } finally {
      setLoading(false);
    }
  };

  // Switch the active brand (full reload on success)
  const switchBrand = async (brandId: string) => {
    if (salesRep?.brand_id && brandId === salesRep.brand_id) {
      return { error: null };
    }
    setLoading(true);
    try {
      await apiSwitchBrand(brandId);
      window.location.assign(landingPathAfterSwitch());
      return { error: null };
    } catch (error) {
      setLoading(false);
      return { error: error as Error };
    }
  };

  // Multi-brand context
  const isPlatformAdmin = !!salesRep?.is_platform_admin;
  const brandRole: BrandRole | null = salesRep
    ? toBrandRole(salesRep.brand_role ?? salesRep.role)
    : null;
  const activeBrand: ActiveBrand | null =
    salesRep && salesRep.brand_id && brandRole
      ? {
          id: salesRep.brand_id,
          slug: salesRep.brand_slug || '',
          display_name: salesRep.brand_name || salesRep.brand_slug || '',
          role: brandRole,
        }
      : null;
  const rawBrands = salesRep?.brands;
  const brands: BrandMembership[] = Array.isArray(rawBrands)
    ? rawBrands.map((b) => ({ ...b, role: toBrandRole(b.role) }))
    : [];
  const rawPermissions = salesRep?.permissions;
  const permissions: string[] = Array.isArray(rawPermissions) ? rawPermissions : [];

  // Helper flags
  const isAuthenticated = !!user && !!salesRep;
  const isAdmin = brandRole === 'admin' || isPlatformAdmin;
  const isSalesRep = salesRep?.role === 'sales_rep' || salesRep?.role === 'member';

  const can = (permission: string): boolean => {
    if (!salesRep) return false;
    if (isPlatformAdmin) return true;
    if (PLATFORM_PERMISSIONS.has(permission)) return false;
    // Older backend without permissions[]: a brand admin holds every brand permission
    if (!Array.isArray(salesRep.permissions)) return brandRole === 'admin';
    return permissions.includes(permission);
  };

  return {
    // State
    user,
    salesRep,
    loading,
    initializing,
    isAuthenticated,
    isAdmin,
    isSalesRep,

    // Multi-brand
    brands,
    activeBrand,
    isPlatformAdmin,
    permissions,
    can,

    // Actions
    signIn,
    signOut,
    refreshUser,
    updateProfile,
    switchBrand,
  };
}

/**
 * Helper function to check if user has required role (in the active brand).
 * Admins (brand admins and platform admins) have access to everything.
 * 'sales_rep' (legacy) and 'member' are the same role.
 */
export function hasRole(salesRep: SalesRep | null, requiredRole: 'admin' | 'sales_rep' | BrandRole): boolean {
  if (!salesRep) return false;

  // Admins have access to everything
  if (salesRep.is_platform_admin) return true;
  const role = toBrandRole(salesRep.brand_role ?? salesRep.role);
  if (role === 'admin') return true;

  // Check specific role
  return role === toBrandRole(requiredRole);
}

/**
 * Helper to check a permission against a sales rep's resolved permission list.
 * Platform admins always pass. Mirrors backend api/permissions.has_permission_for.
 */
export function hasPermission(salesRep: SalesRep | null, permission: string): boolean {
  if (!salesRep) return false;
  if (salesRep.is_platform_admin) return true;
  if (PLATFORM_PERMISSIONS.has(permission)) return false;
  if (!Array.isArray(salesRep.permissions)) {
    return toBrandRole(salesRep.brand_role ?? salesRep.role) === 'admin';
  }
  return salesRep.permissions.includes(permission);
}

/**
 * Helper function to generate campaign link with user's UTM defaults
 */
export function generateCampaignLink(
  salesRep: SalesRep | null,
  campaignName?: string
): string {
  const baseUrl = window.location.origin + '/form';

  if (!salesRep) {
    return baseUrl;
  }

  const params = new URLSearchParams({
    utm_source: salesRep.utm_source || 'email',
    utm_medium: salesRep.utm_medium || 'campaign',
    utm_campaign: campaignName || salesRep.utm_default_campaign || 'general',
    sales_rep_name: salesRep.full_name.replace(/\s+/g, '_'),
    sales_rep_id: salesRep.id,
  });

  return `${baseUrl}?${params.toString()}`;
}
