/**
 * API Response Utilities
 *
 * Standardized response helpers for API routes.
 * All error responses follow consistent JSON structure:
 * {
 *   error: string,           // Human-readable message
 *   code: string,            // Machine-readable error code
 *   details?: object,        // Additional context (optional)
 *   timestamp: string,       // ISO timestamp
 *   requestId?: string       // Request ID if available
 * }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { formatZodErrors } from './validation';

/**
 * Standard error response structure
 */
interface ErrorResponse {
  error: string;
  code: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Build standardized error response
 */
function buildErrorResponse(
  message: string,
  code: string,
  details?: Record<string, unknown>
): ErrorResponse {
  return {
    error: message,
    code,
    details,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Success response with data
 */
export function success<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/**
 * Created response (201)
 */
export function created<T>(data: T): NextResponse {
  return NextResponse.json(data, { status: 201 });
}

/**
 * No content response (204)
 */
export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/**
 * Bad request error (400)
 */
export function badRequest(message: string, details?: Record<string, unknown>): NextResponse {
  return NextResponse.json(
    buildErrorResponse(message, 'BAD_REQUEST', details),
    { status: 400 }
  );
}

/**
 * Validation error from Zod (400)
 */
export function validationError(error: z.ZodError): NextResponse {
  return NextResponse.json(
    buildErrorResponse('Validation failed', 'VALIDATION_ERROR', formatZodErrors(error)),
    { status: 400 }
  );
}

/**
 * Unauthorized error (401)
 */
export function unauthorized(message = 'Authentication required'): NextResponse {
  return NextResponse.json(
    buildErrorResponse(message, 'UNAUTHORIZED'),
    { status: 401 }
  );
}

/**
 * Forbidden error (403)
 */
export function forbidden(message = 'Access denied', details?: Record<string, unknown>): NextResponse {
  return NextResponse.json(
    buildErrorResponse(message, 'FORBIDDEN', details),
    { status: 403 }
  );
}

/**
 * Not found error (404)
 */
export function notFound(resource = 'Resource'): NextResponse {
  return NextResponse.json(
    buildErrorResponse(`${resource} not found`, 'NOT_FOUND'),
    { status: 404 }
  );
}

/**
 * Conflict error (409) - for duplicate resources or state conflicts
 */
export function conflict(message: string, details?: Record<string, unknown>): NextResponse {
  return NextResponse.json(
    buildErrorResponse(message, 'CONFLICT', details),
    { status: 409 }
  );
}

/**
 * Unprocessable entity error (422) - for business logic validation failures
 */
export function unprocessable(message: string, details?: Record<string, unknown>): NextResponse {
  return NextResponse.json(
    buildErrorResponse(message, 'UNPROCESSABLE_ENTITY', details),
    { status: 422 }
  );
}

/**
 * Internal server error (500)
 */
export function serverError(message = 'Internal server error', errorDetails?: Record<string, unknown>): NextResponse {
  return NextResponse.json(
    buildErrorResponse(message, 'INTERNAL_ERROR', errorDetails),
    { status: 500 }
  );
}

/**
 * Idempotent success - resource already exists, return existing
 * Uses 200 OK with idempotent flag
 */
export function idempotentSuccess<T>(data: T, message = 'Resource already exists'): NextResponse {
  return NextResponse.json(
    {
      ...data,
      _idempotent: true,
      _message: message,
    },
    { status: 200 }
  );
}
