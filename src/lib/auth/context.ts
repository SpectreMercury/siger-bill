/**
 * Authorization Context Builder
 *
 * Loads the complete authorization context for an authenticated user,
 * including roles, permissions, and data scopes.
 */

import { prisma } from '@/lib/db';
import { AuthContext, UserScopeData } from '@/lib/types';
import { ScopeType } from '@prisma/client';

const SUPER_ADMIN_ROLE = 'super_admin';

/**
 * Load the complete authorization context for a user.
 *
 * This function performs all the database queries needed to build
 * the auth context in an optimized way.
 */
export async function loadAuthContext(userId: string): Promise<AuthContext | null> {
  // Fetch user with all related authorization data
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      userRoles: {
        include: {
          role: {
            include: {
              rolePermissions: {
                include: {
                  permission: true,
                },
              },
            },
          },
        },
      },
      userScopes: true,
    },
  });

  if (!user || !user.isActive) {
    return null;
  }

  // Extract role names
  const roles = user.userRoles.map((ur) => ur.role.name);

  // Check if super admin (bypasses all scope restrictions)
  const isSuperAdmin = roles.includes(SUPER_ADMIN_ROLE);

  // Flatten permissions from all roles into a Set for O(1) lookup
  const permissions = new Set<string>();
  for (const userRole of user.userRoles) {
    for (const rolePermission of userRole.role.rolePermissions) {
      const perm = rolePermission.permission;
      permissions.add(`${perm.resource}:${perm.action}`);
    }
  }

  // Extract data scopes
  const scopes: UserScopeData[] = user.userScopes.map((scope) => ({
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
  }));

  return {
    userId: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    isActive: user.isActive,
    roles,
    permissions,
    scopes,
    isSuperAdmin,
  };
}

/**
 * Check if user has a specific permission
 */
export function hasPermission(auth: AuthContext, resource: string, action: string): boolean {
  // Super admin bypasses permission checks
  if (auth.isSuperAdmin) {
    return true;
  }
  return auth.permissions.has(`${resource}:${action}`);
}

/**
 * Check if user has access to a specific customer
 */
export function hasCustomerScope(auth: AuthContext, customerId: string): boolean {
  // Super admin bypasses scope restrictions
  if (auth.isSuperAdmin) {
    return true;
  }

  return auth.scopes.some(
    (scope) => scope.scopeType === ScopeType.CUSTOMER && scope.scopeId === customerId
  );
}

/**
 * Get all customer IDs that the user has access to
 */
export function getCustomerScopes(auth: AuthContext): string[] {
  return auth.scopes
    .filter((scope) => scope.scopeType === ScopeType.CUSTOMER)
    .map((scope) => scope.scopeId);
}

/**
 * Build a Prisma WHERE clause for customer-scoped queries.
 *
 * For super_admin: returns undefined (no filter)
 * For other users: returns { customerId: { in: [scopedIds] } }
 */
export function buildCustomerScopeFilter(auth: AuthContext): { customerId: { in: string[] } } | undefined {
  if (auth.isSuperAdmin) {
    return undefined;
  }

  const customerIds = getCustomerScopes(auth);
  return { customerId: { in: customerIds } };
}

/**
 * Get all project IDs that belong to customers the user has access to.
 * Used for scoping raw cost and project queries.
 */
export async function getProjectIdsForUserScope(auth: AuthContext): Promise<string[] | null> {
  // Super admin sees all - return null to skip filtering
  if (auth.isSuperAdmin) {
    return null;
  }

  const customerIds = getCustomerScopes(auth);
  if (customerIds.length === 0) {
    return [];
  }

  // Get all projects bound to the user's customers
  const customerProjects = await prisma.customerProject.findMany({
    where: {
      customerId: { in: customerIds },
      isActive: true,
    },
    include: {
      project: true,
    },
  });

  return customerProjects.map((cp) => cp.project.projectId);
}

/**
 * Check if a project is bound to any of the user's scoped customers
 */
export async function hasProjectScope(auth: AuthContext, projectId: string): Promise<boolean> {
  if (auth.isSuperAdmin) {
    return true;
  }

  const customerIds = getCustomerScopes(auth);
  if (customerIds.length === 0) {
    return false;
  }

  const binding = await prisma.customerProject.findFirst({
    where: {
      project: { projectId },
      customerId: { in: customerIds },
      isActive: true,
    },
  });

  return binding !== null;
}

// ============================================================================
// Phase 2.6 Scope Helpers
// ============================================================================

/**
 * Get all customer IDs that user has access to.
 * Super admin returns null (no restriction).
 * Non-super-admin returns array of scoped customer IDs.
 */
export function getScopedCustomerIds(auth: AuthContext): string[] | null {
  if (auth.isSuperAdmin) {
    return null; // No restriction
  }
  return getCustomerScopes(auth);
}

/**
 * Get all project IDs (GCP project IDs) that user has access to via customer bindings.
 * Super admin returns null (no restriction).
 * Non-super-admin returns array of GCP project IDs from active customer_projects.
 */
export async function getScopedProjectIds(auth: AuthContext): Promise<string[] | null> {
  if (auth.isSuperAdmin) {
    return null; // No restriction
  }

  const customerIds = getCustomerScopes(auth);
  if (customerIds.length === 0) {
    return [];
  }

  const customerProjects = await prisma.customerProject.findMany({
    where: {
      customerId: { in: customerIds },
      isActive: true,
    },
    include: {
      project: { select: { projectId: true } },
    },
  });

  return customerProjects.map((cp) => cp.project.projectId);
}

/**
 * Build a Prisma WHERE clause that restricts to user's scoped customers.
 * Returns undefined for super admin (no restriction).
 * Returns { id: { in: [...] } } for non-super-admin.
 */
export function buildCustomerIdFilter(auth: AuthContext): { id: { in: string[] } } | undefined {
  const customerIds = getScopedCustomerIds(auth);
  if (customerIds === null) {
    return undefined;
  }
  return { id: { in: customerIds } };
}

/**
 * Verify user has access to a specific customer ID.
 * Returns true for super admin or if customer is in user's scope.
 */
export function verifyScopedCustomer(auth: AuthContext, customerId: string): boolean {
  if (auth.isSuperAdmin) {
    return true;
  }
  return hasCustomerScope(auth, customerId);
}
