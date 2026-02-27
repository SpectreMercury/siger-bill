/**
 * GCP Auth Helper
 *
 * Loads GCP credentials from the database (GcpConnection model).
 * Supports SERVICE_ACCOUNT and API_KEY auth types.
 *
 * Priority for each request:
 *  1. Specified connectionId → load that connection
 *  2. Default active connection in DB
 *  3. Env var fallback (GCP_SERVICE_ACCOUNT_JSON / GCP_ACCESS_TOKEN / GCP_API_KEY)
 *     — kept for local development convenience only
 */

import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/db';
import type { AuthContext } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServiceAccountCreds {
  client_email: string;
  private_key: string;
}

export interface ApiKeyCreds {
  key: string;
}

// Module-level token cache (valid within same serverless instance)
const _tokenCache = new Map<string, { token: string; expiresAt: number }>();

// ---------------------------------------------------------------------------
// Internal: exchange service account for access token
// ---------------------------------------------------------------------------

async function exchangeServiceAccountToken(
  creds: ServiceAccountCreds,
  cacheKey: string
): Promise<string | null> {
  const cached = _tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: creds.client_email,
      scope: [
        'https://www.googleapis.com/auth/cloud-billing.readonly',
        'https://www.googleapis.com/auth/cloud-platform.read-only',
      ].join(' '),
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    },
    creds.private_key,
    { algorithm: 'RS256' }
  );

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error('GCP token exchange failed:', res.status, err);
      return null;
    }
    const data: { access_token: string; expires_in: number } = await res.json();
    _tokenCache.set(cacheKey, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 120) * 1000,
    });
    return data.access_token;
  } catch (err) {
    console.error('GCP token exchange network error:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public: get headers from a DB connection
// ---------------------------------------------------------------------------

/**
 * Load the best available GCP connection from DB.
 * If connectionId is provided, load that one; otherwise use the default active connection.
 */
export async function loadGcpConnection(connectionId?: string) {
  if (connectionId) {
    return prisma.gcpConnection.findFirst({
      where: { id: connectionId, isActive: true },
    });
  }
  // default first, then any active
  return (
    (await prisma.gcpConnection.findFirst({ where: { isDefault: true, isActive: true } })) ??
    (await prisma.gcpConnection.findFirst({ where: { isActive: true } }))
  );
}

/**
 * Build fetch headers (Authorization or API key) from a DB connection.
 * Returns null if no valid connection is found.
 */
export async function gcpFetchHeaders(connectionId?: string): Promise<HeadersInit | null> {
  // 1. Try DB
  const conn = await loadGcpConnection(connectionId);
  if (conn) {
    if (conn.authType === 'SERVICE_ACCOUNT') {
      const creds = conn.credentials as unknown as ServiceAccountCreds;
      const token = await exchangeServiceAccountToken(creds, conn.id);
      if (token) return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    }
    if (conn.authType === 'API_KEY') {
      const creds = conn.credentials as unknown as ApiKeyCreds;
      if (creds.key) return { 'X-Goog-Api-Key': creds.key, Accept: 'application/json' };
    }
  }

  // 2. Env var fallback (dev convenience)
  const manualToken = process.env.GCP_ACCESS_TOKEN;
  if (manualToken) return { Authorization: `Bearer ${manualToken}`, Accept: 'application/json' };

  const saJson = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    try {
      const parsed: ServiceAccountCreds = JSON.parse(
        Buffer.from(saJson, 'base64').toString('utf-8')
      );
      const token = await exchangeServiceAccountToken(parsed, 'env_sa');
      if (token) return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    } catch {
      try {
        const parsed: ServiceAccountCreds = JSON.parse(saJson);
        const token = await exchangeServiceAccountToken(parsed, 'env_sa');
        if (token) return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      } catch {
        /* ignore */
      }
    }
  }

  return null;
}

/**
 * Append API key to URL (for Resource Manager fallback).
 */
export function withApiKey(url: string): string {
  const key = process.env.GCP_API_KEY;
  if (!key) return url;
  return `${url}${url.includes('?') ? '&' : '?'}key=${key}`;
}

/**
 * Returns true if any GCP auth is configured (DB or env).
 */
export async function hasGcpAuth(): Promise<boolean> {
  const count = await prisma.gcpConnection.count({ where: { isActive: true } });
  if (count > 0) return true;
  return !!(
    process.env.GCP_SERVICE_ACCOUNT_JSON ||
    process.env.GCP_ACCESS_TOKEN ||
    process.env.GCP_API_KEY
  );
}

/**
 * Resolves which GCP connection ID to use for a given user's auth context.
 *
 * - Super admins: return undefined → `gcpFetchHeaders()` will use the global default
 * - Customer-scoped users: look up their customer's assigned gcpConnectionId
 *
 * Usage in GCP proxy routes:
 *   const connectionId = await resolveGcpConnectionForUser(context.auth);
 *   const headers = await gcpFetchHeaders(connectionId);
 */
export async function resolveGcpConnectionForUser(auth: AuthContext): Promise<string | undefined> {
  if (auth.isSuperAdmin) return undefined;

  // Find the user's CUSTOMER scope
  const customerScope = auth.scopes.find((s) => s.scopeType === 'CUSTOMER');
  if (!customerScope) return undefined;

  const customer = await prisma.customer.findUnique({
    where: { id: customerScope.scopeId },
    select: { gcpConnectionId: true },
  });

  return customer?.gcpConnectionId ?? undefined;
}
