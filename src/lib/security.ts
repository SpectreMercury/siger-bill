/**
 * Security utilities for enterprise-grade hardening
 *
 * Includes:
 * - Password strength validation
 * - Rate limiting helpers
 * - Session timeout configuration
 * - CSRF protection helpers
 */

import { z } from 'zod';

/**
 * Password strength requirements
 */
export const PASSWORD_REQUIREMENTS = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
  specialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?',
};

/**
 * Strong password validation schema
 */
export const strongPasswordSchema = z
  .string()
  .min(PASSWORD_REQUIREMENTS.minLength, `Password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters`)
  .max(PASSWORD_REQUIREMENTS.maxLength, `Password must be at most ${PASSWORD_REQUIREMENTS.maxLength} characters`)
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(
    /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/,
    'Password must contain at least one special character (!@#$%^&*()_+-=[]{}|;:,.<>?)'
  );

/**
 * Validate password strength and return detailed feedback
 */
export function validatePasswordStrength(password: string): {
  isValid: boolean;
  score: number;
  feedback: string[];
} {
  const feedback: string[] = [];
  let score = 0;

  // Length check
  if (password.length >= PASSWORD_REQUIREMENTS.minLength) {
    score += 1;
  } else {
    feedback.push(`Must be at least ${PASSWORD_REQUIREMENTS.minLength} characters`);
  }

  if (password.length >= 12) {
    score += 1; // Bonus for longer passwords
  }

  // Uppercase check
  if (/[A-Z]/.test(password)) {
    score += 1;
  } else if (PASSWORD_REQUIREMENTS.requireUppercase) {
    feedback.push('Must contain an uppercase letter');
  }

  // Lowercase check
  if (/[a-z]/.test(password)) {
    score += 1;
  } else if (PASSWORD_REQUIREMENTS.requireLowercase) {
    feedback.push('Must contain a lowercase letter');
  }

  // Number check
  if (/[0-9]/.test(password)) {
    score += 1;
  } else if (PASSWORD_REQUIREMENTS.requireNumber) {
    feedback.push('Must contain a number');
  }

  // Special character check
  if (/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) {
    score += 1;
  } else if (PASSWORD_REQUIREMENTS.requireSpecial) {
    feedback.push('Must contain a special character');
  }

  // Check for common patterns (weak passwords)
  const commonPatterns = [
    /^123456/,
    /^password/i,
    /^qwerty/i,
    /^admin/i,
    /^letmein/i,
    /^welcome/i,
    /(.)\1{2,}/, // Repeated characters
  ];

  for (const pattern of commonPatterns) {
    if (pattern.test(password)) {
      score = Math.max(0, score - 2);
      feedback.push('Avoid common patterns or repeated characters');
      break;
    }
  }

  return {
    isValid: feedback.length === 0 && score >= 5,
    score: Math.min(6, Math.max(0, score)),
    feedback,
  };
}

/**
 * Session configuration
 */
export const SESSION_CONFIG = {
  // Access token lifetime (15 minutes)
  accessTokenLifetime: 15 * 60 * 1000,

  // Refresh token lifetime (7 days)
  refreshTokenLifetime: 7 * 24 * 60 * 60 * 1000,

  // Session timeout for inactivity (30 minutes)
  inactivityTimeout: 30 * 60 * 1000,

  // Maximum concurrent sessions per user
  maxConcurrentSessions: 5,

  // Cookie settings
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
  },
};

/**
 * Rate limiting configuration
 */
export const RATE_LIMIT_CONFIG = {
  // Login attempts
  login: {
    maxAttempts: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
    lockoutDuration: 30 * 60 * 1000, // 30 minutes after max attempts
  },

  // Password reset attempts
  passwordReset: {
    maxAttempts: 3,
    windowMs: 60 * 60 * 1000, // 1 hour
  },

  // API requests (general)
  api: {
    maxRequests: 100,
    windowMs: 60 * 1000, // 1 minute
  },

  // Data export requests
  export: {
    maxRequests: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
  },
};

/**
 * In-memory rate limiter (for development/simple deployments)
 * Production should use Redis or similar
 */
interface RateLimitEntry {
  count: number;
  firstAttempt: number;
  lockedUntil?: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Check rate limit for a given key
 */
export function checkRateLimit(
  key: string,
  config: { maxAttempts: number; windowMs: number; lockoutDuration?: number }
): {
  allowed: boolean;
  remaining: number;
  retryAfter?: number;
} {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  // Check if locked out
  if (entry?.lockedUntil && now < entry.lockedUntil) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((entry.lockedUntil - now) / 1000),
    };
  }

  // Reset if window expired
  if (!entry || now - entry.firstAttempt > config.windowMs) {
    rateLimitStore.set(key, { count: 1, firstAttempt: now });
    return { allowed: true, remaining: config.maxAttempts - 1 };
  }

  // Increment count
  entry.count++;

  // Check if exceeded
  if (entry.count > config.maxAttempts) {
    if (config.lockoutDuration) {
      entry.lockedUntil = now + config.lockoutDuration;
    }
    return {
      allowed: false,
      remaining: 0,
      retryAfter: config.lockoutDuration
        ? Math.ceil(config.lockoutDuration / 1000)
        : Math.ceil((entry.firstAttempt + config.windowMs - now) / 1000),
    };
  }

  return { allowed: true, remaining: config.maxAttempts - entry.count };
}

/**
 * Reset rate limit for a key (e.g., after successful login)
 */
export function resetRateLimit(key: string): void {
  rateLimitStore.delete(key);
}

/**
 * Generate CSRF token
 */
export function generateCSRFToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate CSRF token
 */
export function validateCSRFToken(token: string, storedToken: string): boolean {
  if (!token || !storedToken) return false;
  if (token.length !== storedToken.length) return false;

  // Constant-time comparison to prevent timing attacks
  let result = 0;
  for (let i = 0; i < token.length; i++) {
    result |= token.charCodeAt(i) ^ storedToken.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Sanitize user input to prevent XSS
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Check if IP is in allowed list (for admin endpoints)
 */
export function isIPAllowed(ip: string, allowedIPs: string[]): boolean {
  if (allowedIPs.length === 0) return true; // No restrictions

  return allowedIPs.some((allowed) => {
    if (allowed.includes('/')) {
      // CIDR notation - simplified check
      const [network, bits] = allowed.split('/');
      // For simplicity, just check prefix match
      return ip.startsWith(network.split('.').slice(0, parseInt(bits) / 8).join('.'));
    }
    return ip === allowed;
  });
}

/**
 * Security headers to add to responses
 */
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Required for Next.js
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

/**
 * Clean up expired rate limit entries (call periodically)
 */
export function cleanupRateLimitStore(): void {
  const now = Date.now();
  rateLimitStore.forEach((entry, key) => {
    // Remove entries older than 1 hour
    if (now - entry.firstAttempt > 60 * 60 * 1000) {
      rateLimitStore.delete(key);
    }
  });
}

// Cleanup every 10 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupRateLimitStore, 10 * 60 * 1000);
}
