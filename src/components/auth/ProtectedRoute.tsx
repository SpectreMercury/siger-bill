'use client';

import { useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

interface ProtectedRouteProps {
  children: ReactNode;
  requiredPermission?: { resource: string; action: string };
  requiredRoles?: string[];
  redirectTo?: string;
}

/**
 * Wrapper component that redirects unauthenticated users
 */
export function ProtectedRoute({
  children,
  requiredPermission,
  requiredRoles,
  redirectTo = '/login',
}: ProtectedRouteProps) {
  const router = useRouter();
  const {
    isAuthenticated,
    isLoading,
    authError,
    refreshUser,
    hasPermission,
    hasRole,
    isSuperAdmin,
  } = useAuth();

  useEffect(() => {
    if (isLoading || (authError && !isAuthenticated)) return;

    if (!isAuthenticated) {
      router.push(redirectTo);
      return;
    }

    if (requiredPermission && !hasPermission(requiredPermission.resource, requiredPermission.action)) {
      router.push('/');
      return;
    }

    if (requiredRoles && requiredRoles.length > 0) {
      const hasRequiredRole = isSuperAdmin || requiredRoles.some((role) => hasRole(role));
      if (!hasRequiredRole) {
        router.push('/');
        return;
      }
    }
  }, [authError, isAuthenticated, isLoading, hasPermission, hasRole, isSuperAdmin, requiredPermission, requiredRoles, router, redirectTo]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (authError && !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-sm px-6">
          <p className="text-sm text-red-600">Unable to verify your session.</p>
          <button
            type="button"
            className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            onClick={() => void refreshUser()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
