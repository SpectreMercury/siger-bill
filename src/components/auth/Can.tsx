'use client';

import { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface CanProps {
  resource: string;
  action: string;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Permission-based visibility component
 *
 * Usage:
 * <Can resource="pricing" action="write">
 *   <EditButton />
 * </Can>
 */
export function Can({ resource, action, children, fallback = null }: CanProps) {
  const { hasPermission, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!hasPermission(resource, action)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

interface CanCustomerProps {
  customerId: string;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Customer scope-based visibility component
 *
 * Usage:
 * <CanCustomer customerId={customer.id}>
 *   <CustomerDetails />
 * </CanCustomer>
 */
export function CanCustomer({ customerId, children, fallback = null }: CanCustomerProps) {
  const { hasCustomerScope, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!hasCustomerScope(customerId)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

interface CanRoleProps {
  roles: string | string[];
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Role-based visibility component
 *
 * Usage:
 * <CanRole roles={['admin', 'finance']}>
 *   <AdminPanel />
 * </CanRole>
 */
export function CanRole({ roles, children, fallback = null }: CanRoleProps) {
  const { hasRole, isSuperAdmin, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  const roleList = Array.isArray(roles) ? roles : [roles];
  const hasRequiredRole = isSuperAdmin || roleList.some((role) => hasRole(role));

  if (!hasRequiredRole) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

interface CanFinanceProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Finance role visibility (includes super_admin, admin, finance)
 */
export function CanFinance({ children, fallback = null }: CanFinanceProps) {
  const { isFinance, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!isFinance) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

interface CanAdminProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Admin visibility (super_admin or admin roles)
 */
export function CanAdmin({ children, fallback = null }: CanAdminProps) {
  const { isAdmin, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!isAdmin) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
