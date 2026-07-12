import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function functionBlock(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  const fallbackStart = source.indexOf(`export function ${name}`);
  const functionStart = start === -1 ? fallbackStart : start;
  assert.notEqual(functionStart, -1, `Missing ${name}`);
  const nextExport = source.indexOf('\nexport ', functionStart + 1);
  return nextExport === -1 ? source.slice(functionStart) : source.slice(functionStart, nextExport);
}

const apiClient = read('src/lib/client/api.ts');
assert(
  apiClient.includes('parseApiResponseBody'),
  'apiFetch must use a guarded response parser instead of exposing raw JSON parse errors'
);
assert(
  !apiClient.includes('const data = await response.json();'),
  'apiFetch must not call response.json() without handling empty or non-JSON responses'
);
assert(
  apiClient.includes('response.status === 204') || apiClient.includes('response.status === 205'),
  'apiFetch must handle empty success responses without JSON parsing'
);

const middleware = read('src/lib/middleware/auth.ts');
assert(
  middleware.includes('middlewareErrorResponse'),
  'auth middleware must convert unexpected auth/context failures to JSON responses'
);
for (const wrapper of ['withAuth', 'withAuthParams', 'withPermission', 'withPermissionAndScope']) {
  const block = functionBlock(middleware, wrapper);
  assert(block.includes('try {'), `${wrapper} must catch unexpected failures`);
  assert(block.includes('middlewareErrorResponse'), `${wrapper} must return JSON on unexpected failures`);
}

const dbClient = read('src/lib/db/prisma.ts');
assert(
  dbClient.includes("process.env.VERCEL === '1' ? 1 : 5"),
  'Vercel functions must default to one database connection per serverless instance'
);
assert(
  dbClient.includes('DATABASE_POOL_MAX'),
  'Database pool size must remain configurable via DATABASE_POOL_MAX'
);

const schema = read('prisma/schema.prisma');
assert(
  schema.includes('billingLineItemsMonthlyTemplateIdx') ||
    schema.includes('billing_line_items_monthly_template_idx'),
  'BillingLineItem must have a composite index for monthly billing template reads'
);

const xlsxExporter = read('src/lib/invoice-presentation/exporters/xlsx.ts');
const monthlyBuilder = functionBlock(xlsxExporter, 'buildBillingTemplateRowsForMonth');
assert(
  !monthlyBuilder.includes('Promise.all(['),
  'Monthly billing reads must not issue concurrent Prisma queries under a single-connection production pool'
);
assert(
  monthlyBuilder.includes('activeBatchIds'),
  'Monthly billing reads must prefilter active ingestion batches before scanning line items'
);
assert(
  monthlyBuilder.includes('loadSkuGroupMappingsForSkuIds'),
  'Monthly billing reads must load SKU group mappings only for the current page'
);
assert(
  !monthlyBuilder.includes('loadSkuGroupMappings();'),
  'Monthly billing reads must not load every SKU group mapping for one page'
);

console.log('API error resilience safeguards verified.');
