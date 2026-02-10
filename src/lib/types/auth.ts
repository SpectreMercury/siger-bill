/**
 * Authentication & Authorization Types
 *
 * Core types for the RBAC and scope-based authorization system.
 */

import { ScopeType } from '@prisma/client';

/**
 * JWT Token payload structure
 */
export interface JWTPayload {
  sub: string;        // User ID
  email: string;
  iat: number;
  exp: number;
}

/**
 * Permission tuple - resource:action format
 */
export interface PermissionTuple {
  resource: string;
  action: string;
}

/**
 * User scope - defines data access boundaries
 */
export interface UserScopeData {
  scopeType: ScopeType;
  scopeId: string;
}

/**
 * Authenticated user context loaded from database
 * This is the core authorization context used throughout the system
 */
export interface AuthContext {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  roles: string[];           // Role names: ['super_admin', 'admin', ...]
  permissions: Set<string>;  // Flattened permissions: 'customers:read', 'invoices:create'
  scopes: UserScopeData[];   // Data access scopes
  isSuperAdmin: boolean;     // Convenience flag for bypass checks
}

/**
 * Request context that gets attached to API handlers
 */
export interface RequestContext {
  auth: AuthContext;
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Login request body
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Login response
 */
export interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    roles: string[];
  };
}

/**
 * API Error response
 */
export interface ApiError {
  error: string;
  code: string;
  details?: Record<string, unknown>;
}
