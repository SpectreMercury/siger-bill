import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src/lib/billing/bigquery-sync.ts'), 'utf8');

assert(
  source.includes('buildBigQuerySourceKeyForConnection'),
  'BigQuery sync must build the same sourceKey as the adapter before deciding whether to fetch'
);

assert(
  source.includes('findReusableActiveBatchForConnection'),
  'BigQuery sync must look for an existing active batch before starting a full BigQuery import'
);

assert(
  source.includes("path: ['sourceKey']"),
  'Reusable active batch lookup must match sourceMetadata.sourceKey, not just provider/month'
);

assert(
  source.includes('reusedActiveBatch'),
  'Sync result metadata must distinguish reused active batches from newly imported batches'
);

assert(
  source.includes('BILLING_ACTIVE_BATCH_REUSE_WINDOW_MS') &&
    source.includes('createdAt: { gte:'),
  'Active batch reuse must have a short freshness window so later syncs fetch updated BigQuery data'
);

const adapterCreateIndex = source.indexOf('createGcpBigQueryAdapterFromConnection(conn)');
const reuseLookupIndex = source.indexOf('findReusableActiveBatchForConnection(conn, billingMonth)');
assert(
  reuseLookupIndex !== -1 && adapterCreateIndex !== -1 && reuseLookupIndex < adapterCreateIndex,
  'BigQuery sync must check for a reusable active batch before creating/fetching through the adapter'
);

console.log('billing sync active batch reuse safeguard verified.');
