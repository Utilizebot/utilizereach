/**
 * ProtectedRoute Component
 *
 * Protects routes that require authentication.
 * Optionally checks for specific user roles.
 *
 * Updated: 2025-10-16 - Phase 1.7
 * Added: Role-based access control
 */

import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import type { UserRole } from '../types/scraper';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: UserRole; // Optional: 'admin' or 'sales_rep'
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { user, salesRep, initializing } = useAuth();

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

  // Check for required role
  if (requiredRole) {
    // Role cannot be verified without a sales_rep record - fail closed
    if (!salesRep) {
      return <Navigate to="/login" replace />;
    }

    // Admins can access everything
    if (salesRep.role === 'admin') {
      return <>{children}</>;
    }

    // Check if user has the required role
    if (salesRep.role !== requiredRole) {
      // Insufficient permissions - redirect to dashboard
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center max-w-md mx-auto p-8">
            <div className="text-red-500 text-5xl mb-4">🚫</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
            <p className="text-gray-600 mb-6">
              You don't have permission to access this page.
              {requiredRole === 'admin' && ' This page is only accessible to administrators.'}
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
  }

  // Authenticated and has required role (if specified) - render children
  return <>{children}</>;
}
