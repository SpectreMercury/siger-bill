import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const syncJobSource = fs.readFileSync(
  path.join(root, 'src/lib/billing/sync-jobs.ts'),
  'utf8'
);
const createRouteSource = fs.readFileSync(
  path.join(root, 'src/app/api/billing/sync-jobs/route.ts'),
  'utf8'
);
const readRouteSource = fs.readFileSync(
  path.join(root, 'src/app/api/billing/sync-jobs/[id]/route.ts'),
  'utf8'
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8')
) as { dependencies?: Record<string, string> };
const prismaSchemaSource = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
const scopeMigrationSource = fs.readFileSync(
  path.join(root, 'prisma/migrations/20260720000100_billing_sync_job_scope/migration.sql'),
  'utf8'
);
const bigQuerySyncSource = fs.readFileSync(
  path.join(root, 'src/lib/billing/bigquery-sync.ts'),
  'utf8'
);
const bigQueryAdapterSource = fs.readFileSync(
  path.join(root, 'src/lib/billing/adapters/gcp-bigquery.ts'),
  'utf8'
);

assert.ok(
  packageJson.dependencies?.['@vercel/functions'],
  'billing sync must register background work with the Vercel function lifecycle'
);
assert.match(
  createRouteSource,
  /export const maxDuration\s*=\s*300/,
  'the sync route must allow enough time for the registered billing task'
);
assert.match(
  createRouteSource,
  /waitUntil\s*\(\s*runBillingSyncJob\(/,
  'POST must register the billing promise with waitUntil before returning 202'
);
assert.doesNotMatch(
  syncJobSource,
  /setTimeout\s*\(/,
  'billing execution must not use fire-and-forget timers in a serverless function'
);

const runnerStart = syncJobSource.indexOf('export async function runBillingSyncJob');
assert.notEqual(runnerStart, -1, 'billing sync runner must exist');
const runnerSource = syncJobSource.slice(runnerStart);
assert.match(
  runnerSource,
  /updateMany\([\s\S]*status:\s*BillingSyncJobStatus\.QUEUED[\s\S]*status:\s*BillingSyncJobStatus\.RUNNING/,
  'workers must atomically claim a queued job before running it'
);
assert.ok(
  runnerSource.indexOf('try {') < runnerSource.indexOf('loadAuthContext('),
  'auth-context failures must be caught and persisted on the job'
);
assert.match(
  runnerSource,
  /claimed\s*\?\s*BillingSyncJobStatus\.RUNNING\s*:\s*BillingSyncJobStatus\.QUEUED/,
  'dispatch failures before claim must finalize the queued job instead of orphaning it'
);

assert.match(
  createRouteSource,
  /BILLING_SYNC_JOB_STALE_AFTER_MS/,
  'POST must recognize an orphaned RUNNING job'
);
assert.match(
  createRouteSource,
  /BILLING_SYNC_JOB_MIN_STALE_AFTER_MS/,
  'stale recovery must not expire a worker before its function timeout'
);
assert.match(
  createRouteSource,
  /hasCustomerScope/,
  'customer-targeted dispatch must validate the caller scope before mutation'
);
assert.match(
  createRouteSource,
  /pg_advisory_xact_lock/,
  'stale expiration and replacement creation must share a transaction lock'
);
assert.match(
  createRouteSource,
  /pg_advisory_xact_lock\([\s\S]*\)::text\s+AS\s+locked/,
  'advisory lock queries must cast PostgreSQL void results before Prisma deserializes them'
);
assert.match(
  createRouteSource,
  /prepareBillingSyncDispatch/,
  'POST must use the behavior-tested dispatch coordinator'
);
assert.match(
  createRouteSource,
  /strict:\s*true/,
  'stale job expiration must write its audit record in the same transaction'
);
assert.match(
  createRouteSource,
  /scopeConnectionIds/,
  'dispatch must coordinate on resolved GCP connection IDs'
);
assert.match(
  prismaSchemaSource,
  /scopeConnectionIds\s+String\[\]/,
  'the effective connection scope must be persisted immutably with the job'
);
assert.match(
  prismaSchemaSource,
  /scopeKey\s+String/,
  'the requested dispatch scope identity must be persisted with the job'
);
assert.match(
  scopeMigrationSource,
  /"connection_id" IS NULL[\s\S]*"customer_id" IS NULL[\s\S]*"status" IN \('QUEUED', 'RUNNING'\)/,
  'active legacy jobs without a resolvable connection scope must be finalized during migration'
);
assert.match(
  runnerSource,
  /resolvedConnectionIds:\s*job\.scopeConnectionIds/,
  'the worker must execute the same connection scope resolved at dispatch time'
);
assert.match(
  bigQuerySyncSource,
  /resolvedConnectionIds/,
  'BigQuery sync must support the immutable job connection scope'
);
assert.match(
  bigQueryAdapterSource,
  /SUM\(billing\.cost\)\s+AS\s+cost/,
  'high-volume billing exports must aggregate cost in BigQuery before downloading rows'
);
assert.match(
  bigQueryAdapterSource,
  /GROUP BY[\s\S]*billing\.project\.id/,
  'billing aggregation must preserve project-level invoice attribution'
);
assert.match(
  bigQueryAdapterSource,
  /Aggregated credits for monthly project\/SKU group/,
  'billing aggregation must preserve the total credit amount for each invoice group'
);
assert.match(
  readRouteSource,
  /canReadBillingSyncJob/,
  'authorized customer operators must be able to poll shared jobs'
);
assert.match(
  createRouteSource,
  /const canReadDispatchedJob = canReadBillingSyncJob[\s\S]*dispatch\.kind === 'existing' && !canReadDispatchedJob/,
  'POST must not return a covering job that the requester cannot safely poll'
);
const resolvedScopeStart = bigQuerySyncSource.indexOf('if (input.resolvedConnectionIds !== undefined)');
assert.notEqual(resolvedScopeStart, -1, 'persisted connection scopes must be supported');
const resolvedScopeSource = bigQuerySyncSource.slice(resolvedScopeStart);
assert.ok(
  resolvedScopeSource.indexOf('if (connectionId && !auth.isSuperAdmin)') <
    resolvedScopeSource.indexOf('const resolvedConnectionIds'),
  'worker must re-check direct-connection privilege before using persisted connections'
);
assert.ok(
  resolvedScopeSource.indexOf('if (customerId && !hasCustomerScope(auth, customerId))') <
    resolvedScopeSource.indexOf('const resolvedConnectionIds'),
  'worker must re-check the original customer scope before using persisted connections'
);

assert.doesNotMatch(
  readRouteSource,
  /startBillingSyncJob|runBillingSyncJob|waitUntil/,
  'GET polling must stay read-only and must never start background work'
);

console.log('billing sync job lifecycle tests passed');
