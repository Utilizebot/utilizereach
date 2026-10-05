/**
 * ProtectedRoute Component
 *
 * Protects routes that require authentication.
 * Optionally checks for a specific role or permission IN THE ACTIVE BRAND.
 *
 * Updated: 2025-10-16 - Phase 1.7
 * Added: Role-based access control
 * Updated: 2026-10 - requiredPermission (mirrors backend require_permission);
 *   roles are per brand; platform admins pass every check.
 */

import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { UserRole } from '../types/scraper';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: UserRole; // Optional: 'admin' | 'manager' | 'member' | 'viewer' ('sales_rep' = 'member')
  requiredPermission?: string; // Optional: "<resource>.<action>" (preferred over requiredRole)
}

/** Canonical role: legacy 'sales_rep' is 'member'. */
function canonical(role: string | null | undefined): string {
  const r = (role || '').toLowerCase();
  return r === 'sales_rep' ? 'member' : r;
}

function AccessDenied({ adminOnly }: { adminOnly?: boolean }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-md mx-auto p-8">
        <div className="text-red-500 text-5xl mb-4">🚫</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
        <p className="text-gray-600 mb-6">
          You don't have permission to access this page.
          {adminOnly && ' This page is only accessible to administrators.'}
        </p>
        <a
          href="/dashboard"
          className="inline-block px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          Go to Dashboard
        </a>
      </div>
    </div>
  );
}

export function ProtectedRoute({ children, requiredRole, requiredPermission }: ProtectedRouteProps) {
  const { user, salesRep, initializing, isAdmin, can } = useAuth();

  // Loading state - still initializing auth
  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Not authenticated - redirect to login
  // Allow access if we have an authenticated user even if salesRep fetch was slow
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Check for required permission (preferred — mirrors backend require_permission)
  if (requiredPermission) {
    // Permission cannot be verified without a sales_rep record - fail closed
    if (!salesRep) {
      return <Navigate to="/login" replace />;
    }
    if (!can(requiredPermission)) {
      return <AccessDenied />;
    }
  }

  // Check for required role
  if (requiredRole) {
    // Role cannot be verified without a sales_rep record - fail closed
    if (!salesRep) {
      return <Navigate to="/login" replace />;
    }

    // Admins (of the active brand, or platform admins) can access everything
    if (isAdmin) {
      return <>{children}</>;
    }

    // Check if user has the required role (in the active brand)
    if (canonical(salesRep.brand_role ?? salesRep.role) !== canonical(requiredRole)) {
      // Insufficient permissions
      return <AccessDenied adminOnly={requiredRole === 'admin'} />;
    }
  }

  // Authenticated and has required role / permission (if specified) - render children
  return <>{children}</>;
}
