/**
 * Authentication & Authorization Middleware
 *
 * Provides request handlers that:
 * 1. Verify JWT tokens
 * 2. Load user context with roles/permissions/scopes
 * 3. Enforce permission and scope-based access control
 */

import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { extractTokenFromHeader, verifyToken } from '@/lib/auth/jwt';
import { loadAuthContext, hasPermission, hasCustomerScope } from '@/lib/auth/context';
import { AuthContext, RequestContext, ApiError } from '@/lib/types';

/**
 * Extract request metadata for audit logging
 */
function extractRequestMetadata(request: NextRequest): {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string;
} {
  const ipAddress =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    null;
  const userAgent = request.headers.get('user-agent');
  const requestId = request.headers.get('x-request-id') || uuidv4();

  return { ipAddress, userAgent, requestId };
}

/**
 * Create an error response
 */
function errorResponse(error: ApiError, status: number): NextResponse {
  return NextResponse.json(error, { status });
}

/**
 * Route params passed by Next.js to dynamic route handlers
 * In Next.js 14+, params is a Promise
 */
interface RouteParams {
  params: Promise<Record<string, string>>;
}

/**
 * Extended request context that includes route params
 * params is resolved synchronously in middleware for easier handler usage
 */
export interface ExtendedRequestContext extends RequestContext {
  params: Record<string, string>;
}

/**
 * Authentication handler type
 */
type AuthenticatedHandler = (
  request: NextRequest,
  context: RequestContext
) => Promise<NextResponse>;

/**
 * Authentication handler type with route params
 */
type AuthenticatedHandlerWithParams = (
  request: NextRequest,
  context: ExtendedRequestContext
) => Promise<NextResponse>;

/**
 * Wrap an API route handler with authentication.
 *
 * This middleware:
 * 1. Extracts and verifies the JWT token
 * 2. Loads the full auth context from the database
 * 3. Passes the context to the handler
 *
 * Usage:
 * ```
 * export const GET = withAuth(async (request, context) => {
 *   const { auth } = context;
 *   // auth.userId, auth.roles, auth.permissions, auth.scopes available
 * });
 * ```
 */
export function withAuth(handler: AuthenticatedHandler) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const { ipAddress, userAgent, requestId } = extractRequestMetadata(request);

    // Extract token from header
    const authHeader = request.headers.get('authorization');
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return errorResponse(
        { error: 'Authentication required', code: 'AUTH_REQUIRED' },
        401
      );
    }

    // Verify token
    const payload = verifyToken(token);
    if (!payload) {
      return errorResponse(
        { error: 'Invalid or expired token', code: 'INVALID_TOKEN' },
        401
      );
    }

    // Load auth context
    const auth = await loadAuthContext(payload.sub);
    if (!auth) {
      return errorResponse(
        { error: 'User not found or inactive', code: 'USER_INACTIVE' },
        401
      );
    }

    const requestContext: RequestContext = {
      auth,
      requestId,
      ipAddress,
      userAgent,
    };

    return handler(request, requestContext);
  };
}

/**
 * Wrap an API route handler with authentication, also passing resolved route params.
 * Use this for dynamic routes (e.g. /api/admin/gcp-connections/[id]) that need
 * context.params but don't require a specific permission check.
 *
 * Usage:
 * ```
 * export const GET = withAuthParams(async (request, context) => {
 *   const { id } = context.params;
 * });
 * ```
 */
export function withAuthParams(handler: AuthenticatedHandlerWithParams) {
  return async (request: NextRequest, routeParams?: RouteParams): Promise<NextResponse> => {
    const { ipAddress, userAgent, requestId } = extractRequestMetadata(request);

    const authHeader = request.headers.get('authorization');
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return errorResponse({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      return errorResponse({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' }, 401);
    }

    const auth = await loadAuthContext(payload.sub);
    if (!auth) {
      return errorResponse({ error: 'User not found or inactive', code: 'USER_INACTIVE' }, 401);
    }

    const resolvedParams = routeParams?.params ? await routeParams.params : {};

    const extendedContext: ExtendedRequestContext = {
      auth,
      requestId,
      ipAddress,
      userAgent,
      params: resolvedParams,
    };

    return handler(request, extendedContext);
  };
}

/**
 * Configuration for permission-based authorization
 */
interface PermissionConfig {
  resource: string;
  action: string;
}

/**
 * Wrap an API route handler with authentication AND permission check.
 * Supports both simple routes and dynamic routes with params.
 *
 * Usage:
 * ```
 * export const POST = withPermission(
 *   { resource: 'customers', action: 'create' },
 *   async (request, context) => {
 *     // User is authenticated and has customers:create permission
 *     // For dynamic routes: context.params.id is available
 *   }
 * );
 * ```
 */
export function withPermission(
  permission: PermissionConfig,
  handler: AuthenticatedHandlerWithParams
) {
  return async (request: NextRequest, routeParams?: RouteParams): Promise<NextResponse> => {
    const { ipAddress, userAgent, requestId } = extractRequestMetadata(request);

    // Extract token from header
    const authHeader = request.headers.get('authorization');
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return errorResponse(
        { error: 'Authentication required', code: 'AUTH_REQUIRED' },
        401
      );
    }

    // Verify token
    const payload = verifyToken(token);
    if (!payload) {
      return errorResponse(
        { error: 'Invalid or expired token', code: 'INVALID_TOKEN' },
        401
      );
    }

    // Load auth context
    const auth = await loadAuthContext(payload.sub);
    if (!auth) {
      return errorResponse(
        { error: 'User not found or inactive', code: 'USER_INACTIVE' },
        401
      );
    }

    if (!hasPermission(auth, permission.resource, permission.action)) {
      return errorResponse(
        {
          error: 'Permission denied',
          code: 'PERMISSION_DENIED',
          details: { required: `${permission.resource}:${permission.action}` },
        },
        403
      );
    }

    // Resolve params Promise for Next.js 14+ compatibility
    const resolvedParams = routeParams?.params ? await routeParams.params : {};

    const extendedContext: ExtendedRequestContext = {
      auth,
      requestId,
      ipAddress,
      userAgent,
      params: resolvedParams,
    };

    return handler(request, extendedContext);
  };
}

/**
 * Wrap an API route handler with authentication AND customer scope check.
 *
 * The customerId must be provided via a function that extracts it from the request.
 *
 * Usage:
 * ```
 * export const GET = withCustomerScope(
 *   (req) => req.nextUrl.searchParams.get('customerId'),
 *   async (request, context) => {
 *     // User has access to this customer
 *   }
 * );
 * ```
 */
export function withCustomerScope(
  getCustomerId: (request: NextRequest) => string | null,
  handler: AuthenticatedHandler
) {
  return withAuth(async (request, context) => {
    const customerId = getCustomerId(request);

    if (!customerId) {
      return errorResponse(
        { error: 'Customer ID is required', code: 'CUSTOMER_ID_REQUIRED' },
        400
      );
    }

    if (!hasCustomerScope(context.auth, customerId)) {
      return errorResponse(
        {
          error: 'Access denied to this customer',
          code: 'SCOPE_DENIED',
          details: { customerId },
        },
        403
      );
    }

    return handler(request, context);
  });
}

/**
 * Route params with resolved params (not Promise) for getCustomerId callbacks
 */
interface ResolvedRouteParams {
  params: Record<string, string>;
}

/**
 * Combined permission and customer scope check.
 *
 * Usage:
 * ```
 * export const PUT = withPermissionAndScope(
 *   { resource: 'invoices', action: 'update' },
 *   (req, routeParams) => routeParams?.params.customerId ?? null,
 *   async (request, context) => {
 *     // User has permission AND access to customer
 *   }
 * );
 * ```
 */
export function withPermissionAndScope(
  permission: PermissionConfig,
  getCustomerId: (request: NextRequest, routeParams?: ResolvedRouteParams) => string | null | Promise<string | null>,
  handler: AuthenticatedHandlerWithParams
) {
  return async (request: NextRequest, routeParams?: RouteParams): Promise<NextResponse> => {
    const { ipAddress, userAgent, requestId } = extractRequestMetadata(request);

    // Extract token from header
    const authHeader = request.headers.get('authorization');
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return errorResponse(
        { error: 'Authentication required', code: 'AUTH_REQUIRED' },
        401
      );
    }

    // Verify token
    const payload = verifyToken(token);
    if (!payload) {
      return errorResponse(
        { error: 'Invalid or expired token', code: 'INVALID_TOKEN' },
        401
      );
    }

    // Load auth context
    const auth = await loadAuthContext(payload.sub);
    if (!auth) {
      return errorResponse(
        { error: 'User not found or inactive', code: 'USER_INACTIVE' },
        401
      );
    }

    // Check permission first
    if (!hasPermission(auth, permission.resource, permission.action)) {
      return errorResponse(
        {
          error: 'Permission denied',
          code: 'PERMISSION_DENIED',
          details: { required: `${permission.resource}:${permission.action}` },
        },
        403
      );
    }

    // Resolve params Promise for Next.js 14+ compatibility
    const resolvedParams = routeParams?.params ? await routeParams.params : {};
    const resolvedRouteParams: ResolvedRouteParams = { params: resolvedParams };

    // Then check scope (skip for super_admin)
    if (!auth.isSuperAdmin) {
      const customerId = await Promise.resolve(getCustomerId(request, resolvedRouteParams));

      if (customerId && !hasCustomerScope(auth, customerId)) {
        return errorResponse(
          {
            error: 'Access denied to this customer',
            code: 'SCOPE_DENIED',
            details: { customerId },
          },
          403
        );
      }
    }

    const extendedContext: ExtendedRequestContext = {
      auth,
      requestId,
      ipAddress,
      userAgent,
      params: resolvedParams,
    };

    return handler(request, extendedContext);
  };
}
