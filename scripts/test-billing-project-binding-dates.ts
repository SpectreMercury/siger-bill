import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing section start: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Missing section end: ${endMarker}`);
  return source.slice(start, end);
}

function assertUsesActiveBindingsWithoutEffectiveDates(
  source: string,
  label: string
): void {
  assert(
    source.includes('isActive: true'),
    `${label} must continue to require an active customer/project binding`
  );
  assert(
    !source.includes('startDate') && !source.includes('endDate'),
    `${label} must not exclude already-ingested billing data based on binding dates`
  );
}

const activeSources = read('src/lib/billing/active-sources.ts');
const activeSourceBindingLookup = section(
  activeSources,
  'async function findProjectIdsForCustomers(',
  'export async function findActiveBigQueryProjectOverlaps('
);
assertUsesActiveBindingsWithoutEffectiveDates(
  activeSourceBindingLookup,
  'Active BigQuery source overlap detection'
);
assert(
  activeSourceBindingLookup.includes('if (customerIds?.length === 0) return [];'),
  'An explicitly empty customer scope must resolve to no active projects'
);
assert(
  activeSourceBindingLookup.includes(
    '...(customerIds ? { customerId: { in: customerIds } } : {})'
  ),
  'An omitted customer scope must resolve projects from all active bindings'
);

for (const callerPath of [
  'src/lib/billing/bigquery-sync.ts',
  'src/app/api/invoice-runs/[id]/execute/route.ts',
]) {
  const caller = read(callerPath);
  assert(
    /findActiveBigQueryProjectOverlaps\(\s*(?:billingMonth|invoiceRun\.billingMonth),\s*\{ customerIds: affectedCustomerIds \}\s*\)/.test(
      caller
    ),
    `${callerPath} must preserve an explicitly empty affected-customer scope`
  );
}

for (const enginePath of [
  'src/lib/billing/engine.ts',
  'src/lib/billing/unified-engine.ts',
]) {
  const engine = read(enginePath);
  assert(
    !engine.includes('bindingOverlapsBillingMonth'),
    `${enginePath} must use all currently active project bindings regardless of startDate/endDate`
  );
  assert(
    !engine.includes('startDate: true') && !engine.includes('endDate: true'),
    `${enginePath} must not load binding effective dates for billing selection`
  );
  assert(
    engine.includes('customerProjects: {\n          where: { isActive: true }'),
    `${enginePath} must continue to load only active customer/project bindings`
  );
}

const xlsx = read('src/lib/invoice-presentation/exporters/xlsx.ts');
assertUsesActiveBindingsWithoutEffectiveDates(
  section(
    xlsx,
    'async function buildBillingTemplateRows(invoiceId: string)',
    'type CustomerForTemplate ='
  ),
  'Invoice billing export'
);
assertUsesActiveBindingsWithoutEffectiveDates(
  section(
    xlsx,
    'async function getActiveProjectCustomers(',
    'async function loadPricingRulesForCustomers('
  ),
  'Monthly billing detail lookup'
);

console.log('Billing project selection ignores binding dates and uses active bindings only.');
