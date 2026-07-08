import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(file: string): string {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function extractBlock(source: string, startPattern: RegExp): string {
  const match = startPattern.exec(source);
  if (!match) {
    throw new Error(`Missing block matching ${startPattern}`);
  }
  const start = match.index;
  const nextSection = source.indexOf('\n// =============================================================================', start + 1);
  return source.slice(start, nextSection === -1 ? undefined : nextSection);
}

const expectedCreditTypes = [
  'FEE_UTILIZATION_OFFSET',
  'DISCOUNT',
  'SUSTAINED_USAGE_DISCOUNT',
  'COMMITTED_USAGE_DISCOUNT',
  'COMMITTED_USAGE_DISCOUNT_DOLLAR_BASE',
  'PROMOTION',
];

const expectedBillingFields = [
  'billingAccountName',
  'projectName',
  'serviceDescription',
  'skuDescription',
  'pricingUsageAmount',
  'pricingUsageUnit',
  'currencyConversionRate',
  'transactionType',
  'creditBreakdown',
  'creditAmount',
  'costAfterCredit',
];

const expectedOverrideFields = [
  'billingMonth',
  'customerId',
  'sourceFileHash',
  'sourceFilename',
  'isActive',
  'uploadedBy',
];

const expectedCostHeaders = [
  '公司名称',
  '账单账号ID',
  '账单名称',
  '项目名称',
  '项目ID',
  '服务描述',
  '服务ID',
  'SKU描述',
  'SKUid',
  '使用开始时间',
  '使用结束时间',
  '使用量',
  '用量单位',
  '费用单位',
  '列表价',
  '经销商价',
  '代金券减免',
  '代金券减免后金额',
  'Discount/Price',
  '最终付款金额',
  '折后总金额(CNY,不含税)',
  'transaction_type',
  '汇率',
];

const schema = read('prisma/schema.prisma');
const creditTypeBlock = extractBlock(schema, /enum CreditType \{/);
const billingLineItemBlock = extractBlock(schema, /model BillingLineItem \{/);

for (const type of expectedCreditTypes) {
  assert(creditTypeBlock.includes(type), `CreditType is missing ${type}`);
}
assert(!creditTypeBlock.includes('SUBSCRIPTION_BENEFIT'), 'CreditType still contains SUBSCRIPTION_BENEFIT');

for (const field of expectedBillingFields) {
  assert(billingLineItemBlock.includes(field), `BillingLineItem is missing ${field}`);
}

const overrideBlock = extractBlock(schema, /model BillingMonthlyOverride \{/);
const overrideLineBlock = extractBlock(schema, /model BillingMonthlyOverrideLine \{/);
for (const field of expectedOverrideFields) {
  assert(overrideBlock.includes(field), `BillingMonthlyOverride is missing ${field}`);
}
for (const field of expectedCostHeaders) {
  assert(overrideLineBlock.includes(field) || overrideLineBlock.includes('rowData'), `Override line model cannot store ${field}`);
}

const monthlyTemplate = read('src/lib/billing/monthly-template.ts');
const xlsxExporter = read('src/lib/invoice-presentation/exporters/xlsx.ts');
for (const header of expectedCostHeaders) {
  assert(monthlyTemplate.includes(`'${header}'`), `Monthly template is missing COST header ${header}`);
}
assert(!monthlyTemplate.includes("'资源名称'"), 'Monthly template still contains standard-version header 资源名称');
assert(!monthlyTemplate.includes("'合同优惠金额'"), 'Monthly template still contains standard-version header 合同优惠金额');
assert(xlsxExporter.includes('costAfterCredit'), 'XLSX exporter does not use costAfterCredit');
assert(xlsxExporter.includes('buildOverrideTemplateRowsForMonth'), 'XLSX exporter does not prefer monthly overrides');

const monthlyOverrideLib = read('src/lib/billing/monthly-overrides.ts');
for (const fragment of [
  'parseBillingOverrideWorkbook',
  'createBillingMonthlyOverride',
  'findActiveBillingMonthlyOverride',
  'TEMPLATE_HEADERS',
]) {
  assert(monthlyOverrideLib.includes(fragment), `Monthly override library is missing ${fragment}`);
}

const overrideRoute = read('src/app/api/billing/monthly-lines/overrides/route.ts');
for (const fragment of [
  'formData',
  'createBillingMonthlyOverride',
  'findActiveBillingMonthlyOverride',
  'getBillingMonthLockReason',
]) {
  assert(overrideRoute.includes(fragment), `Monthly override route is missing ${fragment}`);
}

const activeSources = read('src/lib/billing/active-sources.ts');
for (const fragment of ['InvoiceStatus.LOCKED', 'InvoiceRunStatus.LOCKED']) {
  assert(activeSources.includes(fragment), `Active source guard is missing ${fragment}`);
}

const gcpAdapter = read('src/lib/billing/adapters/gcp-bigquery.ts');
for (const fragment of [
  'projectName',
  'serviceDescription',
  'skuDescription',
  'pricingUsageAmount',
  'pricingUsageUnit',
  'currencyConversionRate',
  'transactionType',
  'creditBreakdown',
  'creditAmount',
  'costAfterCredit',
]) {
  assert(gcpAdapter.includes(fragment), `GCP adapter does not map ${fragment}`);
}

const unifiedEngine = read('src/lib/billing/unified-engine.ts');
for (const field of expectedBillingFields) {
  assert(unifiedEngine.includes(field), `Unified ingestion does not persist ${field}`);
}

const validation = read('src/lib/utils/validation.ts');
for (const type of expectedCreditTypes) {
  assert(validation.includes(`'${type}'`), `Validation schema is missing ${type}`);
}
assert(!validation.includes("'SUBSCRIPTION_BENEFIT'"), 'Validation schema still allows SUBSCRIPTION_BENEFIT');
for (const field of ['matchSkuId', 'matchSkuGroupId', 'matchProjectId']) {
  assert(validation.includes(field), `Credit validation is missing ${field}`);
}

const customerCreditRoute = read('src/app/api/customers/[id]/credits/route.ts');
for (const field of ['matchSkuId', 'matchSkuGroupId', 'matchProjectId', 'matchSkuGroup']) {
  assert(customerCreditRoute.includes(field), `Customer credit route is missing ${field}`);
}

const customerCreditsTab = read('src/components/admin/CustomerCreditsTab.tsx');
assert(customerCreditsTab.includes('FEE_UTILIZATION_OFFSET'), 'Customer credits UI is missing FEE_UTILIZATION_OFFSET');
assert(!customerCreditsTab.includes('SUBSCRIPTION_BENEFIT'), 'Customer credits UI still contains SUBSCRIPTION_BENEFIT');

const monthlyBillingPage = read('src/app/(console)/admin/monthly-billing/page.tsx');
for (const fragment of ['handleUploadOverride', 'Override', 'Upload']) {
  assert(monthlyBillingPage.includes(fragment), `Monthly billing page is missing ${fragment}`);
}

console.log('billing credit fields checks passed');
