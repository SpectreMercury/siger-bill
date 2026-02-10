/**
 * POST /api/auth/login
 *
 * Authenticate a user and return a JWT token.
 * Includes rate limiting for security.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateToken, verifyPassword } from '@/lib/auth';
import { logLogin } from '@/lib/audit';
import { validateBody, loginSchema, validationError, unauthorized, success, serverError } from '@/lib/utils';
import { checkRateLimit, resetRateLimit, RATE_LIMIT_CONFIG } from '@/lib/security';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Extract metadata for audit logging
  const ipAddress =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const userAgent = request.headers.get('user-agent');

  // Rate limiting check
  const rateLimitKey = `login:${ipAddress}`;
  const rateLimit = checkRateLimit(rateLimitKey, RATE_LIMIT_CONFIG.login);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many login attempts. Please try again later.',
        retryAfter: rateLimit.retryAfter,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimit.retryAfter || 60),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  try {
    // Validate request body
    const validation = await validateBody(request, loginSchema);
    if (!validation.success) {
      return validationError(validation.error);
    }

    const { email, password } = validation.data;

    // Per-email rate limiting (more aggressive)
    const emailRateLimitKey = `login:email:${email.toLowerCase()}`;
    const emailRateLimit = checkRateLimit(emailRateLimitKey, {
      ...RATE_LIMIT_CONFIG.login,
      maxAttempts: 3, // Fewer attempts per email
    });

    if (!emailRateLimit.allowed) {
      await logLogin('', email, ipAddress, userAgent, false);
      return NextResponse.json(
        {
          error: 'Too many login attempts for this account. Please try again later.',
          retryAfter: emailRateLimit.retryAfter,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(emailRateLimit.retryAfter || 60),
          },
        }
      );
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        userRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    // User not found - log failed attempt
    if (!user) {
      await logLogin('', email, ipAddress, userAgent, false);
      return unauthorized('Invalid email or password');
    }

    // User inactive
    if (!user.isActive) {
      await logLogin(user.id, email, ipAddress, userAgent, false);
      return unauthorized('Account is disabled');
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      await logLogin(user.id, email, ipAddress, userAgent, false);
      return unauthorized('Invalid email or password');
    }

    // Successful login - reset rate limits
    resetRateLimit(rateLimitKey);
    resetRateLimit(emailRateLimitKey);

    // Generate token
    const token = generateToken(user.id, user.email);

    // Update last login timestamp
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Log successful login
    await logLogin(user.id, email, ipAddress, userAgent, true);

    // Return token and user info with security headers
    const response = success({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: user.userRoles.map((ur) => ur.role.name),
      },
    });

    // Add rate limit headers
    response.headers.set('X-RateLimit-Remaining', String(rateLimit.remaining));

    return response;

  } catch (error) {
    console.error('Login error:', error);
    return serverError('Authentication failed');
  }
}
