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
  !unifiedEngine.includes('billingIngestionBatch.deleteMany'),
  'BigQuery sync must not delete old ingestion batches'
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
  xlsxExporter.includes('ingestionBatch: { isActive: true }'),
  'Monthly BigQuery template fallback must read only active batches'
);

const fetchRoute = read('src/app/api/billing/fetch/route.ts');
assert(fetchRoute.includes('getBillingMonthLockReason'), 'BigQuery fetch route must block locked months');
assert(fetchRoute.includes('LOCKED_BILLING_MONTH'), 'BigQuery fetch route must return a lock-specific conflict code');
assert(fetchRoute.includes('affectedCustomerIds'), 'BigQuery fetch route must lock-check all customers affected by synced connections');
assert(fetchRoute.includes('sourceConflicts'), 'BigQuery fetch route must return source overlap warnings');

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
