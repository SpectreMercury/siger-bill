import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src/lib/db/prisma.ts'), 'utf8');
const billingEngineSource = readFileSync(
  join(process.cwd(), 'src/lib/billing/unified-engine.ts'),
  'utf8'
);

assert(
  source.includes('withTransientPrismaRetry') &&
    !source.includes('async $allOperations'),
  'Prisma retry must be explicit and must not automatically repeat every read and write operation'
);

assert(
  source.includes('Connection terminated unexpectedly') &&
    source.includes('Connection terminated due to connection timeout') &&
    source.includes('Client has encountered a connection error and is not queryable') &&
    source.includes('secure TLS connection was established') &&
    source.includes('ECONNRESET'),
  'Prisma client retry must cover observed Cloud SQL connection reset errors'
);

assert(
  source.includes("'P2037'"),
  'Prisma retry helper must recognize exhausted database connections as transient'
);

assert(
  source.includes("process.env.VERCEL === '1' ? 1 : 5"),
  'Vercel serverless functions must default to one database connection per instance'
);

assert(
  billingEngineSource.includes('withTransientPrismaRetry(() =>') &&
    billingEngineSource.includes('prisma.$transaction('),
  'Billing ingestion transaction must be wrapped in transient retry after long BigQuery fetches'
);

assert(
  billingEngineSource.includes('BILLING_INGEST_TRANSACTION_TIMEOUT_MS') &&
    billingEngineSource.includes('600_000') &&
    !billingEngineSource.includes('timeout: 240_000'),
  'Billing ingestion transaction timeout must be configurable and long enough for large BigQuery exports'
);

console.log('prisma client transient retry verified.');
