/**
 * useAuth Hook - Authentication Utilities
 *
 * Provides authentication state and functions for the application.
 * Backed by the FastAPI JWT auth endpoints (/api/auth/*).
 * Token lives in localStorage under 'auth_token'.
 *
 * Phase: 1.6 - Authentication Enhancement
 * Created: 2025-10-16
 * Updated: 2026-08-12 - Migrated off Supabase to backend JWT auth
 */

import { useState, useEffect } from 'react';
import {
  login as apiLogin,
  logout as apiLogout,
  getMe,
  updateMe,
  getStoredToken,
  clearStoredToken,
  userFromSalesRep,
} from '../lib/auth';
import type { AuthUser } from '../lib/auth';
import type { SalesRep } from '../types/scraper';

interface AuthState {
  // Authenticated user (from backend JWT auth)
  user: AuthUser | null;

  // Sales rep data from sales_reps table
  salesRep: SalesRep | null;

  // Loading states
  loading: boolean;
  initializing: boolean;

  // Helper flags
  isAuthenticated: boolean;
  isAdmin: boolean;
  isSalesRep: boolean;
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
      } catch (error) {
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
      setSalesRep(rep);
      setUser(userFromSalesRep(rep));
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    } finally {
      setLoading(false);
    }
  };

  // Helper flags
  const isAuthenticated = !!user && !!salesRep;
  const isAdmin = salesRep?.role === 'admin';
  const isSalesRep = salesRep?.role === 'sales_rep';

  return {
    // State
    user,
    salesRep,
    loading,
    initializing,
    isAuthenticated,
    isAdmin,
    isSalesRep,

    // Actions
    signIn,
    signOut,
    refreshUser,
    updateProfile,
  };
}

/**
 * Helper function to check if user has required role
 */
export function hasRole(salesRep: SalesRep | null, requiredRole: 'admin' | 'sales_rep'): boolean {
  if (!salesRep) return false;

  // Admins have access to everything
  if (salesRep.role === 'admin') return true;

  // Check specific role
  return salesRep.role === requiredRole;
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
