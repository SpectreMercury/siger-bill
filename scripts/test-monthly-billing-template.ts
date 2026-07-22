import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import {
  accumulateMonthlyBillingRow,
  calculateMonthlyBillingAmounts,
  createMonthlyProviderCreditAllocator,
  createMonthlyBillingAccumulator,
  DEFAULT_MONTHLY_PRICING_BASIS,
  formatMonthlyNumericCell,
  finalizeMonthlyBillingGroups,
  selectMonthlyPricingMultiplier,
  type MonthlyBillingSourceRow,
} from '../src/lib/billing/monthly-template-calculation';
import {
  COST_TEMPLATE_HEADERS,
  resolveMonthlyTemplateHeaders,
  STANDARD_TEMPLATE_HEADERS,
} from '../src/lib/billing/monthly-template';
import {
  assertValidBigQueryPathPart,
  isValidBigQueryPathPart,
} from '../src/lib/billing/bigquery-reference';

const decimal = (value: string | number) => new Prisma.Decimal(value);

assert.equal(DEFAULT_MONTHLY_PRICING_BASIS, 'STANDARD');
assert.ok(STANDARD_TEMPLATE_HEADERS.includes('资源名称'));
assert.ok(STANDARD_TEMPLATE_HEADERS.includes('合同优惠金额'));
assert.ok(STANDARD_TEMPLATE_HEADERS.includes('代金券减免'));
assert.ok(!STANDARD_TEMPLATE_HEADERS.includes('经销商价' as never));
assert.ok(COST_TEMPLATE_HEADERS.includes('经销商价'));
assert.equal(resolveMonthlyTemplateHeaders('STANDARD'), STANDARD_TEMPLATE_HEADERS);
assert.equal(resolveMonthlyTemplateHeaders('COST'), COST_TEMPLATE_HEADERS);
assert.equal(formatMonthlyNumericCell(decimal('422.808012')), 422.808012);
assert.equal(typeof formatMonthlyNumericCell(decimal('-94.078696')), 'number');

const standard = calculateMonthlyBillingAmounts({
  priceBasis: 'STANDARD',
  listAmount: decimal('422.808012'),
  resellerCost: decimal('422.808012'),
  providerCreditAmount: decimal('-133.528044'),
  multiplier: decimal('1'),
});

assert.equal(standard.voucherAmount.toString(), '-133.528044');
assert.equal(standard.amountAfterCredit.toString(), '289.279968');
assert.equal(standard.finalAmount.toString(), '289.279968');

const cost = calculateMonthlyBillingAmounts({
  priceBasis: 'COST',
  listAmount: decimal('422.808012'),
  resellerCost: decimal('422.808012'),
  providerCreditAmount: decimal('-133.528044'),
  multiplier: decimal('0.9'),
});

assert.equal(cost.voucherAmount.toString(), '-133.528044');
assert.equal(cost.amountAfterCredit.toString(), '289.279968');
assert.equal(cost.finalAmount.toString(), '260.3519712');

const differentBasesStandard = calculateMonthlyBillingAmounts({
  priceBasis: 'STANDARD',
  listAmount: decimal('120'),
  resellerCost: decimal('100'),
  providerCreditAmount: decimal('-20'),
  multiplier: decimal('0.9'),
});
const differentBasesCost = calculateMonthlyBillingAmounts({
  priceBasis: 'COST',
  listAmount: decimal('120'),
  resellerCost: decimal('100'),
  providerCreditAmount: decimal('-20'),
  multiplier: decimal('0.9'),
});
assert.equal(differentBasesStandard.amountAfterCredit.toString(), '100');
assert.equal(differentBasesCost.amountAfterCredit.toString(), '80');
assert.equal(differentBasesStandard.finalAmount.toString(), '88');
assert.equal(differentBasesCost.finalAmount.toString(), '72');
assert.equal(differentBasesStandard.voucherAmount.toString(), '-20');
assert.equal(differentBasesCost.voucherAmount.toString(), '-20');

const seCreditAllocator = createMonthlyProviderCreditAllocator([{
  id: 'se-credit',
  types: ['DISCOUNT', 'PROMOTION'],
  remainingAmount: decimal('900000'),
  currency: 'USD',
  billingAccountId: null,
  matchSkuId: null,
  matchSkuGroupId: null,
  matchProjectId: null,
}]);
const seCredits = seCreditAllocator.allocate({
  accountId: 'billing-1',
  projectId: 'project-1',
  skuId: 'sku-1',
  skuGroupIds: [],
  currency: 'USD',
  breakdown: [
    { type: 'DISCOUNT', amount: decimal('-1.716'), convertedAmount: decimal('-12.012') },
    { type: 'PROMOTION', amount: decimal('-92.362696'), convertedAmount: decimal('-646.538872') },
    { type: 'RESELLER_MARGIN', amount: decimal('-39.449348'), convertedAmount: decimal('-276.145436') },
  ],
});
assert.equal(seCredits.amount.toString(), '-94.078696');
assert.equal(seCredits.convertedAmount?.toString(), '-658.550872');

const btCreditAllocator = createMonthlyProviderCreditAllocator([]);
const btCredits = btCreditAllocator.allocate({
  accountId: 'billing-1',
  projectId: 'project-1',
  skuId: 'sku-1',
  skuGroupIds: [],
  currency: 'USD',
  breakdown: [
    { type: 'DISCOUNT', amount: decimal('-3.421062'), convertedAmount: decimal('-23.947434') },
  ],
});
assert.equal(btCredits.amount.toString(), '0');
assert.equal(btCredits.convertedAmount?.toString(), '0');

const scopedCreditAllocator = createMonthlyProviderCreditAllocator([{
  id: 'scoped-credit',
  types: ['DISCOUNT'],
  remainingAmount: decimal('5'),
  currency: 'USD',
  billingAccountId: null,
  matchSkuId: null,
  matchSkuGroupId: null,
  matchProjectId: 'project-1',
}]);
const cappedCredits = scopedCreditAllocator.allocate({
  accountId: 'billing-1',
  projectId: 'project-1',
  skuId: 'sku-1',
  skuGroupIds: [],
  currency: 'USD',
  breakdown: [
    { type: 'DISCOUNT', amount: decimal('-7'), convertedAmount: decimal('-49') },
  ],
});
assert.equal(cappedCredits.amount.toString(), '-5');
assert.equal(cappedCredits.convertedAmount?.toString(), '-35');
const depletedCredits = scopedCreditAllocator.allocate({
  accountId: 'billing-1',
  projectId: 'project-1',
  skuId: 'sku-1',
  skuGroupIds: [],
  currency: 'USD',
  breakdown: [
    { type: 'DISCOUNT', amount: decimal('-1'), convertedAmount: decimal('-7') },
  ],
});
assert.equal(depletedCredits.amount.toString(), '0');

const wrongCurrencyAllocator = createMonthlyProviderCreditAllocator([{
  id: 'cny-credit',
  types: ['DISCOUNT'],
  remainingAmount: decimal('100'),
  currency: 'CNY',
  billingAccountId: null,
  matchSkuId: null,
  matchSkuGroupId: null,
  matchProjectId: null,
}]);
const wrongCurrencyCredits = wrongCurrencyAllocator.allocate({
  accountId: 'billing-1',
  projectId: 'project-1',
  skuId: 'sku-1',
  skuGroupIds: [],
  currency: 'USD',
  breakdown: [
    { type: 'DISCOUNT', amount: decimal('-10'), convertedAmount: decimal('-70') },
  ],
});
assert.equal(wrongCurrencyCredits.amount.toString(), '0');

const cappedTypes = [
  { type: 'PROMOTION', amount: decimal('-4'), convertedAmount: decimal('-28') },
  { type: 'DISCOUNT', amount: decimal('-4'), convertedAmount: decimal('-32') },
];
const allocateCappedTypes = (breakdown: typeof cappedTypes) => createMonthlyProviderCreditAllocator([{
  id: 'multi-type-credit',
  types: ['DISCOUNT', 'PROMOTION'],
  remainingAmount: decimal('5'),
  currency: 'USD',
  billingAccountId: null,
  matchSkuId: null,
  matchSkuGroupId: null,
  matchProjectId: null,
}]).allocate({
  accountId: 'billing-1',
  projectId: 'project-1',
  skuId: 'sku-1',
  skuGroupIds: [],
  currency: 'USD',
  breakdown,
});
const forwardTypeAllocation = allocateCappedTypes(cappedTypes);
const reversedTypeAllocation = allocateCappedTypes([...cappedTypes].reverse());
assert.equal(forwardTypeAllocation.amount.toString(), '-5');
assert.equal(forwardTypeAllocation.convertedAmount?.toString(), '-39');
assert.equal(reversedTypeAllocation.amount.toString(), forwardTypeAllocation.amount.toString());
assert.equal(
  reversedTypeAllocation.convertedAmount?.toString(),
  forwardTypeAllocation.convertedAmount?.toString(),
  'credit type input order must not change capped allocation'
);

const tierMultiplier = selectMonthlyPricingMultiplier({
  ruleType: 'TIERED',
  baseAmount: decimal('9592.54122'),
  discountRate: null,
  tiers: [
    { from: 0, to: 10000, rate: 0.9 },
    { from: 10000, to: 50000, rate: 0.8 },
  ],
});
assert.equal(tierMultiplier.toString(), '0.9');

function sourceRow(overrides: Partial<MonthlyBillingSourceRow>): MonthlyBillingSourceRow {
  return {
    id: crypto.randomUUID(),
    accountId: 'billing-1',
    billingAccountName: 'Billing One',
    subaccountId: 'project-1',
    projectName: 'Project One',
    productId: 'service-1',
    serviceDescription: 'Service One',
    meterId: 'sku-1',
    skuDescription: 'SKU One',
    usageAmount: decimal('1'),
    usageUnit: 'count',
    pricingUsageAmount: decimal('1'),
    pricingUsageUnit: 'count',
    cost: decimal('10'),
    listCost: decimal('12'),
    creditAmount: decimal('-2'),
    creditBreakdown: [
      { type: 'DISCOUNT', amount: decimal('-2'), convertedAmount: decimal('-2') },
    ],
    costAfterCredit: decimal('8'),
    currency: 'USD',
    currencyConversionRate: decimal('1'),
    transactionType: 'GOOGLE',
    usageStartTime: new Date('2026-06-02T00:00:00.000Z'),
    usageEndTime: new Date('2026-06-03T00:00:00.000Z'),
    ...overrides,
  };
}

const accumulator = createMonthlyBillingAccumulator();
accumulateMonthlyBillingRow(accumulator, sourceRow({}));
accumulateMonthlyBillingRow(accumulator, sourceRow({
  usageAmount: decimal('2'),
  pricingUsageAmount: null,
  cost: decimal('20'),
  listCost: null,
  creditAmount: decimal('-4'),
  creditBreakdown: [
    { type: 'DISCOUNT', amount: decimal('-4'), convertedAmount: decimal('-8') },
  ],
  costAfterCredit: null,
  currencyConversionRate: decimal('2'),
  usageStartTime: new Date('2026-06-01T00:00:00.000Z'),
  usageEndTime: new Date('2026-06-05T00:00:00.000Z'),
}));
accumulateMonthlyBillingRow(accumulator, sourceRow({
  accountId: 'billing-2',
  usageStartTime: new Date('2026-06-01T12:00:00.000Z'),
}));
accumulateMonthlyBillingRow(accumulator, sourceRow({
  accountId: 'billing-sort',
  productId: 'service-z',
  creditBreakdown: [],
  usageStartTime: new Date('2026-06-10T00:00:00.000Z'),
}));
accumulateMonthlyBillingRow(accumulator, sourceRow({
  accountId: 'billing-sort',
  productId: 'service-a',
  creditBreakdown: [],
  usageStartTime: new Date('2026-06-10T00:00:00.000Z'),
}));

const groups = finalizeMonthlyBillingGroups(accumulator);
assert.equal(groups.length, 4, 'different billing accounts and services must remain separate');
assert.deepEqual(
  groups.filter((group) => group.accountId === 'billing-sort').map((group) => group.productId),
  ['service-a', 'service-z'],
  'merged rows must have a deterministic service-aware order'
);

const merged = groups.find((group) => group.accountId === 'billing-1');
assert.ok(merged);
assert.equal(merged.sourceRowCount, 2);
assert.equal(merged.usageAmount.toString(), '3');
assert.equal(merged.pricingUsageAmount?.toString(), '3');
assert.equal(merged.listCost?.toString(), '36');
assert.equal(merged.cost.toString(), '30');
assert.equal(merged.creditAmount.toString(), '-6');
assert.equal(merged.costAfterCredit?.toString(), '24');
assert.equal(merged.listCostConverted?.toString(), '60');
assert.equal(merged.costAfterCreditConverted?.toString(), '40');
assert.equal(merged.resellerCostConverted?.toString(), '50');
assert.equal(merged.creditBreakdown.length, 1);
assert.equal(merged.creditBreakdown[0].type, 'DISCOUNT');
assert.equal(merged.creditBreakdown[0].amount.toString(), '-6');
assert.equal(merged.creditBreakdown[0].convertedAmount?.toString(), '-10');
assert.equal(merged.pricingUsageAmountConverted?.toString(), '5');
assert.equal(merged.usageStartTime.toISOString(), '2026-06-01T00:00:00.000Z');
assert.equal(merged.usageEndTime.toISOString(), '2026-06-05T00:00:00.000Z');

assert.equal(isValidBigQueryPathPart('test_billing_2'), true);
assert.equal(isValidBigQueryPathPart('share.test_billing_2'), false);
assert.throws(
  () => assertValidBigQueryPathPart('share.test_billing_2', 'table'),
  /Table name must not include project or dataset prefixes/
);

console.log('monthly billing template tests passed');
