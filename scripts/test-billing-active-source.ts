import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function modelBlock(schema: string, modelName: string): string {
  const match = schema.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`));
  assert(match, `Could not find model ${modelName}`);
  return match[0];
}

const schema = read('prisma/schema.prisma');
const batchModel = modelBlock(schema, 'BillingIngestionBatch');
assert(batchModel.includes('isActive'), 'BillingIngestionBatch must track the active imported version');
assert(batchModel.includes('supersededAt'), 'BillingIngestionBatch must keep supersession time for audit');
assert(
  existsSync(join(root, 'prisma/migrations/20260624000100_active_billing_ingestion_batches/migration.sql')),
  'Missing migration for active billing ingestion batches'
);

const activeSources = read('src/lib/billing/active-sources.ts');
assert(activeSources.includes('getBillingMonthLockReason'), 'Missing shared billing month lock guard');
assert(activeSources.includes('InvoiceStatus.LOCKED'), 'Lock guard must check locked invoices');
assert(activeSources.includes('InvoiceRunStatus.LOCKED'), 'Lock guard must check locked invoice runs');
assert(
  activeSources.includes('targetCustomerId: null'),
  'Customer-scoped sync must also respect month-wide locked runs'
);
assert(
  activeSources.includes('findActiveBigQueryProjectOverlaps'),
  'Missing active BigQuery project overlap detector'
);
assert(
  activeSources.includes('distinctSourceCount') && activeSources.includes('sourceLabels'),
  'Overlap detector must report source counts and labels'
);

const unifiedEngine = read('src/lib/billing/unified-engine.ts');
assert(
  unifiedEngine.includes('billingIngestionBatch.deleteMany') &&
    unifiedEngine.includes('id: batchId') &&
    unifiedEngine.includes('isActive: false') &&
    unifiedEngine.includes('updatedAt: { lte: staleBefore }'),
  'BigQuery sync may only delete the specific stale incomplete inactive batch'
);
assert(
  !unifiedEngine.includes('billingIngestionBatch.deleteMany({\n      where: sameSourceWhere'),
  'BigQuery sync must not delete historical batches for the same source'
);
assert(
  unifiedEngine.includes('isActive: false') && unifiedEngine.includes('supersededAt'),
  'BigQuery sync must supersede old batches instead of deleting them'
);
assert(
  unifiedEngine.includes('lineItemFilter.ingestionBatch = { isActive: true }'),
  'Normal BigQuery invoice execution must read only active batches'
);

const xlsxExporter = read('src/lib/invoice-presentation/exporters/xlsx.ts');
assert(
  xlsxExporter.includes('sourceType: BillingSourceType.BIGQUERY_EXPORT'),
  'Monthly BigQuery template fallback must exclude manual override line items'
);
assert(
  xlsxExporter.includes('activeBatchIds') && xlsxExporter.includes('ingestionBatchId: { in: activeBatchIds }'),
  'Monthly BigQuery template fallback must read only active batches'
);

const bigQuerySync = read('src/lib/billing/bigquery-sync.ts');
assert(bigQuerySync.includes('getBillingMonthLockReason'), 'BigQuery sync must block locked months');
assert(bigQuerySync.includes('LOCKED_BILLING_MONTH'), 'BigQuery sync must return a lock-specific conflict code');
assert(bigQuerySync.includes('affectedCustomerIds'), 'BigQuery sync must lock-check all customers affected by synced connections');
assert(bigQuerySync.includes('sourceConflicts'), 'BigQuery sync must return source overlap warnings');

const executeRoute = read('src/app/api/invoice-runs/[id]/execute/route.ts');
assert(executeRoute.includes('getBillingMonthLockReason'), 'BigQuery invoice execution must guard refetches');
assert(executeRoute.includes('affectedCustomerIds'), 'BigQuery invoice execution must lock-check all customers affected by synced connections');
assert(executeRoute.includes('OVERLAPPING_BIGQUERY_SOURCES'), 'BigQuery invoice execution must block overlapping active sources');

const monthlyPage = read('src/app/(console)/admin/monthly-billing/page.tsx');
assert(
  monthlyPage.includes('customerId: selectedCustomerId'),
  'Monthly billing page should pass the selected customer when syncing BigQuery'
);
assert(monthlyPage.includes('syncWarning'), 'Monthly billing page must display sync overlap warnings');
assert(monthlyPage.includes('variant="warning"'), 'Monthly billing page must render overlap warnings as warnings');

console.log('Billing active-source safeguards verified.');
