import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const authContext = readFileSync(join(process.cwd(), 'src/lib/auth/context.ts'), 'utf8');
const prismaClient = readFileSync(join(process.cwd(), 'src/lib/db/prisma.ts'), 'utf8');

assert(
  authContext.includes('isTransientAuthContextDbError'),
  'loadAuthContext must classify transient database connection errors'
);

assert(
  authContext.includes('AUTH_CONTEXT_MAX_ATTEMPTS') &&
    authContext.includes('AUTH_CONTEXT_RETRY_DELAY_MS'),
  'loadAuthContext must use a bounded retry for transient database connection errors'
);

assert(
  authContext.includes('Connection terminated unexpectedly') &&
    authContext.includes('Connection terminated due to connection timeout') &&
    authContext.includes('secure TLS connection was established') &&
    authContext.includes('ECONNRESET'),
  'loadAuthContext retry must cover observed Cloud SQL TLS reset errors'
);

assert(
  authContext.includes("'P2037'"),
  'loadAuthContext retry must recognize exhausted database connections as transient'
);

assert(
  authContext.includes('getErrorMessages') && authContext.includes('cause'),
  'loadAuthContext retry must inspect nested cause errors from pg/Prisma'
);

assert(
  !prismaClient.includes("['query', 'error', 'warn']") &&
    !prismaClient.includes("['error']"),
  'Prisma client must not auto-log handled query errors before retry logic can recover'
);

console.log('auth context transient database retry verified.');
