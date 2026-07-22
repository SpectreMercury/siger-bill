/**
 * XLSX Exporter (Phase 6)
 *
 * Exports invoice data in the reseller billing detail template used for
 * monthly customer billing reconciliation.
 */

import * as XLSX from 'xlsx';
import {
  PricingBasis,
  Prisma,
  PricingRuleType,
} from '@prisma/client';
import { prisma } from '@/lib/db';
import {
  COST_TEMPLATE_HEADERS,
  STANDARD_TEMPLATE_HEADERS,
  type BillingTemplateBuildResult,
  type BillingTemplateHeaders,
  type BillingTemplateRow,
} from '@/lib/billing/monthly-template';
import { buildOverrideTemplateRowsForMonth } from '@/lib/billing/monthly-overrides';
import {
  calculateMonthlyBillingAmounts,
  createMonthlyProviderCreditAllocator,
  DEFAULT_MONTHLY_PRICING_BASIS,
  formatMonthlyNumericCell,
  selectMonthlyPricingMultiplier,
  type MonthlyCustomerCreditConfig,
  type MonthlyBillingGroup,
  type MonthlyProviderCreditBreakdown,
} from '@/lib/billing/monthly-template-calculation';
import { ACTIVE_PRICING_LIST_ORDER } from '@/lib/pricing/active-list';
import { matchesPricingBillingAccount } from '@/lib/pricing/billing-account-scope';
import { InvoicePresentation, ExportResult, ExportOptions, CreditBreakdown, PricingBreakdown } from '../types';
import { generateContentHash } from '../builder';

type PricingRuleForExport = {
  id: string;
  isDefault: boolean;
  ruleType: PricingRuleType;
  discountRate: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
  tiers: Prisma.JsonValue | null;
  effectiveStart: Date | null;
  effectiveEnd: Date | null;
  skuGroups: Array<{ skuGroup: { id: string; code: string } }>;
};

type SkuGroupMappingForExport = {
  skuId: string;
  skuGroupId: string;
  skuGroupCode: string;
};

type MonthlyCreditBreakdownQueryRow = {
  accountId: string;
  subaccountId: string | null;
  productId: string;
  meterId: string;
  type: string;
  amount: Prisma.Decimal;
  convertedAmount: Prisma.Decimal | null;
};

type MonthlyProviderCreditAllocation = {
  amount: Prisma.Decimal;
  convertedAmount: Prisma.Decimal | null;
};

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function formatMoneyCell(value: Prisma.Decimal | null): number | null {
  return formatMonthlyNumericCell(value);
}

function monthlyGroupKey(item: Pick<MonthlyBillingGroup, 'accountId' | 'subaccountId' | 'productId' | 'meterId'>): string {
  return JSON.stringify([item.accountId, item.subaccountId ?? '', item.productId, item.meterId]);
}

function headersForTemplate(priceBasis: PricingBasis): BillingTemplateHeaders {
  return priceBasis === PricingBasis.STANDARD
    ? STANDARD_TEMPLATE_HEADERS
    : COST_TEMPLATE_HEADERS;
}

function headerRow(headers: BillingTemplateHeaders): BillingTemplateRow {
  return [...headers];
}

function ruleAppliesToMonth(rule: PricingRuleForExport, monthStart: Date, monthEnd: Date): boolean {
  const effectiveStart = rule.effectiveStart ?? new Date(0);
  const effectiveEnd = rule.effectiveEnd ?? new Date('2100-01-01');
  return effectiveStart < monthEnd && effectiveEnd >= monthStart;
}

function selectRule(
  rules: PricingRuleForExport[],
  skuGroupIds: string[],
  monthStart: Date,
  monthEnd: Date
): PricingRuleForExport | null {
  const effectiveRules = rules.filter((rule) => ruleAppliesToMonth(rule, monthStart, monthEnd));
  if (skuGroupIds.length > 0) {
    const mappedGroupIds = new Set(skuGroupIds);
    const explicit = effectiveRules.find(
      (rule) => !rule.isDefault && rule.skuGroups.some((g) => mappedGroupIds.has(g.skuGroup.id))
    );
    if (explicit) return explicit;
  }
  return effectiveRules.find((rule) => rule.isDefault) ?? null;
}

function discountLabel(
  rule: PricingRuleForExport | null,
  priceBasis: PricingBasis,
  multiplier: Prisma.Decimal
): string {
  const base = priceBasis === PricingBasis.STANDARD ? 'List' : 'Cost';
  if (!rule) return `${base} * 100%`;
  if (rule.ruleType === 'LIST_DISCOUNT' && rule.discountRate != null) {
    return `${base} * ${rule.discountRate.mul(100).toDecimalPlaces(4).toString()}%`;
  }
  if (rule.ruleType === 'UNIT_PRICE' && rule.unitPrice != null) {
    return `Unit Price ${rule.unitPrice.toString()}`;
  }
  if (rule.ruleType === 'TIERED') {
    return `${base} * ${multiplier.mul(100).toDecimalPlaces(4).toString()}% (Tiered)`;
  }
  return `${base} * 100%`;
}

async function loadSkuGroupMappingsForSkuIds(skuIds: string[]): Promise<Map<string, SkuGroupMappingForExport[]>> {
  const uniqueSkuIds = Array.from(new Set(skuIds.filter(Boolean)));
  if (uniqueSkuIds.length === 0) return new Map();

  const mappings = await prisma.skuGroupMapping.findMany({
    where: {
      sku: { skuId: { in: uniqueSkuIds } },
    },
    select: {
      sku: { select: { skuId: true } },
      skuGroup: { select: { id: true, code: true } },
    },
  });

  const map = new Map<string, SkuGroupMappingForExport[]>();
  for (const mapping of mappings) {
    const entries = map.get(mapping.sku.skuId) ?? [];
    entries.push({
      skuId: mapping.sku.skuId,
      skuGroupId: mapping.skuGroup.id,
      skuGroupCode: mapping.skuGroup.code,
    });
    map.set(mapping.sku.skuId, entries);
  }
  return map;
}

async function loadMergedBillingGroups(params: {
  billingMonth: string;
  projectIds: string[];
}): Promise<MonthlyBillingGroup[]> {
  if (params.projectIds.length === 0) return [];

  const groups = await prisma.$queryRaw<MonthlyBillingGroup[]>(Prisma.sql`
    SELECT
      MIN(line.id::text) AS "id",
      line.account_id AS "accountId",
      MAX(line.billing_account_name) AS "billingAccountName",
      line.subaccount_id AS "subaccountId",
      MAX(line.project_name) AS "projectName",
      line.product_id AS "productId",
      MAX(line.service_description) AS "serviceDescription",
      line.meter_id AS "meterId",
      MAX(line.sku_description) AS "skuDescription",
      SUM(line.usage_amount) AS "usageAmount",
      MAX(line.usage_unit) AS "usageUnit",
      SUM(COALESCE(line.pricing_usage_amount, line.usage_amount)) AS "pricingUsageAmount",
      MAX(line.pricing_usage_unit) AS "pricingUsageUnit",
      SUM(line.cost) AS "cost",
      SUM(COALESCE(line.list_cost, line.cost - line.credit_amount)) AS "listCost",
      SUM(line.credit_amount) AS "creditAmount",
      SUM(COALESCE(line.cost_after_credit, line.cost + line.credit_amount)) AS "costAfterCredit",
      MAX(line.currency) AS "currency",
      MAX(line.currency_conversion_rate) AS "currencyConversionRate",
      CASE
        WHEN COUNT(line.currency_conversion_rate) = COUNT(*)
        THEN SUM(
          COALESCE(line.list_cost, line.cost - line.credit_amount)
          * line.currency_conversion_rate
        )
        ELSE NULL
      END AS "listCostConverted",
      CASE
        WHEN COUNT(line.currency_conversion_rate) = COUNT(*)
        THEN SUM(line.cost * line.currency_conversion_rate)
        ELSE NULL
      END AS "resellerCostConverted",
      CASE
        WHEN COUNT(line.currency_conversion_rate) = COUNT(*)
        THEN SUM(
          COALESCE(line.cost_after_credit, line.cost + line.credit_amount)
          * line.currency_conversion_rate
        )
        ELSE NULL
      END AS "costAfterCreditConverted",
      CASE
        WHEN COUNT(line.currency_conversion_rate) = COUNT(*)
        THEN SUM(
          COALESCE(line.pricing_usage_amount, line.usage_amount)
          * line.currency_conversion_rate
        )
        ELSE NULL
      END AS "pricingUsageAmountConverted",
      MAX(line.transaction_type) AS "transactionType",
      MIN(line.usage_start_time) AS "usageStartTime",
      MAX(line.usage_end_time) AS "usageEndTime",
      COUNT(*)::int AS "sourceRowCount"
    FROM billing_line_items line
    JOIN billing_ingestion_batches batch
      ON batch.id = line.ingestion_batch_id
    WHERE line.provider = 'GCP'::billing_provider
      AND line.source_type = 'BIGQUERY_EXPORT'::billing_source_type
      AND line.invoice_month = ${params.billingMonth}
      AND line.subaccount_id IN (${Prisma.join(params.projectIds)})
      AND batch.is_active = true
    GROUP BY
      line.account_id,
      line.subaccount_id,
      line.product_id,
      line.meter_id
    ORDER BY
      MIN(line.usage_start_time),
      line.subaccount_id,
      line.product_id,
      line.meter_id,
      line.account_id
  `);

  const breakdownRows = await prisma.$queryRaw<MonthlyCreditBreakdownQueryRow[]>(Prisma.sql`
    SELECT
      line.account_id AS "accountId",
      line.subaccount_id AS "subaccountId",
      line.product_id AS "productId",
      line.meter_id AS "meterId",
      credit.value->>'type' AS "type",
      SUM(NULLIF(credit.value->>'amount', '')::numeric) AS "amount",
      CASE
        WHEN COUNT(line.currency_conversion_rate) = COUNT(*)
        THEN SUM(
          NULLIF(credit.value->>'amount', '')::numeric
          * line.currency_conversion_rate
        )
        ELSE NULL
      END AS "convertedAmount"
    FROM billing_line_items line
    JOIN billing_ingestion_batches batch
      ON batch.id = line.ingestion_batch_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(line.credit_breakdown) = 'array' THEN line.credit_breakdown
        ELSE '[]'::jsonb
      END
    ) AS credit(value)
    WHERE line.provider = 'GCP'::billing_provider
      AND line.source_type = 'BIGQUERY_EXPORT'::billing_source_type
      AND line.invoice_month = ${params.billingMonth}
      AND line.subaccount_id IN (${Prisma.join(params.projectIds)})
      AND batch.is_active = true
      AND credit.value ? 'type'
      AND credit.value ? 'amount'
    GROUP BY
      line.account_id,
      line.subaccount_id,
      line.product_id,
      line.meter_id,
      credit.value->>'type'
    ORDER BY
      line.subaccount_id,
      line.product_id,
      line.meter_id,
      line.account_id,
      credit.value->>'type'
  `);

  const breakdownByGroup = new Map<string, MonthlyProviderCreditBreakdown[]>();
  for (const row of breakdownRows) {
    const key = monthlyGroupKey(row);
    const breakdown = breakdownByGroup.get(key) ?? [];
    breakdown.push({
      type: row.type,
      amount: row.amount,
      convertedAmount: row.convertedAmount,
    });
    breakdownByGroup.set(key, breakdown);
  }

  return groups.map((group) => ({
    ...group,
    creditBreakdown: breakdownByGroup.get(monthlyGroupKey(group)) ?? [],
  }));
}

async function buildBillingTemplateRows(invoiceId: string): Promise<{
  invoiceNumber: string;
  rows: BillingTemplateRow[];
}> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: {
        include: {
          customerProjects: {
            where: { isActive: true },
            select: { projectId: true, startDate: true, endDate: true },
          },
        },
      },
    },
  });

  if (!invoice) {
    throw new Error(`Invoice not found: ${invoiceId}`);
  }

  const overrideRows = await buildOverrideTemplateRowsForMonth({
    billingMonth: invoice.billingMonth,
    customerId: invoice.customerId,
    all: true,
  });
  if (overrideRows) {
    return { invoiceNumber: invoice.invoiceNumber, rows: overrideRows.rows };
  }

  const [year, month] = invoice.billingMonth.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));
  const activeProjectIds = invoice.customer.customerProjects
    .filter((binding) => {
      const start = binding.startDate ?? new Date(0);
      const end = binding.endDate ?? new Date('2100-01-01');
      return start < monthEnd && end >= monthStart;
    })
    .map((binding) => binding.projectId);

  const loadedLineItems = await loadMergedBillingGroups({
    billingMonth: invoice.billingMonth,
    projectIds: activeProjectIds,
  });

  const projectConfigs = await prisma.projectBillingConfig.findMany({
    where: { projectId: { in: activeProjectIds } },
    select: { projectId: true, name: true },
  });
  const projectNameById = new Map(projectConfigs.map((project) => [project.projectId, project.name]));

  const pricingList = await prisma.pricingList.findFirst({
    where: { customerId: invoice.customerId, status: 'ACTIVE' },
    orderBy: ACTIVE_PRICING_LIST_ORDER,
    include: {
      pricingRules: {
        include: { skuGroups: { include: { skuGroup: { select: { id: true, code: true } } } } },
        orderBy: [{ isDefault: 'asc' }, { createdAt: 'desc' }],
      },
    },
  });
  const rules = pricingList?.pricingRules ?? [];
  const lineItems = loadedLineItems.filter((item) => matchesPricingBillingAccount(
    pricingList?.billingAccountIds ?? [],
    item.accountId
  ));
  const skuGroupMappings = await loadSkuGroupMappingsForSkuIds(lineItems.map((item) => item.meterId));
  const creditAllocators = await loadMonthlyCreditAllocatorsForCustomers(
    [invoice.customerId],
    invoice.billingMonth
  );
  const customer = {
    id: invoice.customerId,
    name: invoice.customer.name,
    externalId: invoice.customer.externalId,
  };
  const priceBasis = pricingList?.priceBasis ?? DEFAULT_MONTHLY_PRICING_BASIS;
  const templateHeaders = headersForTemplate(priceBasis);

  const rows: BillingTemplateRow[] = [headerRow(templateHeaders)];

  for (const item of lineItems) {
    const mappings = skuGroupMappings.get(item.meterId) ?? [];
    const rule = selectRule(rules, mappings.map((mapping) => mapping.skuGroupId), monthStart, monthEnd);
    const providerCredit = allocateProviderCreditsForItem({
      item,
      customerId: invoice.customerId,
      skuGroupMappings,
      allocators: creditAllocators,
    });
    rows.push(buildTemplateDataRow({
      item,
      customer,
      projectName: item.subaccountId ? projectNameById.get(item.subaccountId) : null,
      rule,
      priceBasis,
      templateBasis: priceBasis,
      providerCredit,
    }));
  }

  return { invoiceNumber: invoice.invoiceNumber, rows };
}

type CustomerForTemplate = {
  id: string;
  name: string;
  externalId: string | null;
};

type TemplateBuildOptions = {
  billingMonth: string;
  priceBasis?: PricingBasis;
  customerId?: string;
  customerIds?: string[];
  page?: number;
  limit?: number;
  all?: boolean;
};

async function getActiveProjectCustomers(
  billingMonth: string,
  customerId?: string,
  customerIds?: string[]
): Promise<Map<string, CustomerForTemplate>> {
  const [year, month] = billingMonth.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));
  const bindings = await prisma.customerProject.findMany({
    where: {
      isActive: true,
      ...(customerId
        ? { customerId }
        : customerIds
          ? { customerId: { in: customerIds } }
          : {}),
      AND: [
        { OR: [{ startDate: null }, { startDate: { lt: monthEnd } }] },
        { OR: [{ endDate: null }, { endDate: { gte: monthStart } }] },
      ],
    },
    select: {
      projectId: true,
      customer: { select: { id: true, name: true, externalId: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return new Map(bindings.map((binding) => [binding.projectId, binding.customer]));
}

async function loadPricingRulesForCustomers(customerIds: string[]) {
  const lists = await prisma.pricingList.findMany({
    where: { customerId: { in: customerIds }, status: 'ACTIVE' },
    include: {
      pricingRules: {
        include: { skuGroups: { include: { skuGroup: { select: { id: true, code: true } } } } },
        orderBy: [{ isDefault: 'asc' }, { createdAt: 'desc' }],
      },
    },
    orderBy: ACTIVE_PRICING_LIST_ORDER,
  });

  const pricingByCustomer = new Map<string, {
    priceBasis: PricingBasis;
    billingAccountIds: string[];
    rules: PricingRuleForExport[];
  }>();
  for (const list of lists) {
    if (!pricingByCustomer.has(list.customerId)) {
      pricingByCustomer.set(list.customerId, {
        priceBasis: list.priceBasis,
        billingAccountIds: list.billingAccountIds,
        rules: list.pricingRules,
      });
    }
  }
  return pricingByCustomer;
}

async function loadTemplateBasisForCustomer(customerId: string): Promise<PricingBasis> {
  const pricingList = await prisma.pricingList.findFirst({
    where: { customerId, status: 'ACTIVE' },
    orderBy: ACTIVE_PRICING_LIST_ORDER,
    select: { priceBasis: true },
  });
  return pricingList?.priceBasis ?? DEFAULT_MONTHLY_PRICING_BASIS;
}

export class MixedMonthlyBillingTemplateError extends Error {
  constructor() {
    super('STANDARD and COST customers cannot share one billing template; select a customer');
    this.name = 'MixedMonthlyBillingTemplateError';
  }
}

export class MonthlyBillingCustomerSelectionError extends Error {
  constructor() {
    super('Select a customer before reading or exporting a month-wide billing override');
    this.name = 'MonthlyBillingCustomerSelectionError';
  }
}

export class MonthlyBillingOverrideBasisMismatchError extends Error {
  constructor(
    public readonly storedBasis: PricingBasis,
    public readonly requestedBasis: PricingBasis
  ) {
    super(`The active override uses ${storedBasis}, but ${requestedBasis} was requested`);
    this.name = 'MonthlyBillingOverrideBasisMismatchError';
  }
}

function workbookTemplateBasis(
  customerIds: string[],
  pricingByCustomer: ReadonlyMap<string, { priceBasis: PricingBasis }>
): PricingBasis {
  if (customerIds.length === 0) return PricingBasis.COST;
  const bases = new Set(customerIds.map((customerId) => (
    pricingByCustomer.get(customerId)?.priceBasis ?? DEFAULT_MONTHLY_PRICING_BASIS
  )));
  if (bases.size > 1) throw new MixedMonthlyBillingTemplateError();
  return bases.has(PricingBasis.STANDARD) ? PricingBasis.STANDARD : PricingBasis.COST;
}

type MonthlyProviderCreditAllocator = ReturnType<typeof createMonthlyProviderCreditAllocator>;

async function loadMonthlyCreditAllocatorsForCustomers(
  customerIds: string[],
  billingMonth: string
): Promise<Map<string, MonthlyProviderCreditAllocator>> {
  if (customerIds.length === 0) return new Map();

  const [year, month] = billingMonth.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));
  const credits = await prisma.credit.findMany({
    where: {
      customerId: { in: customerIds },
      status: 'ACTIVE',
      remainingAmount: { gt: 0 },
      validFrom: { lt: monthEnd },
      validTo: { gte: monthStart },
    },
    select: {
      id: true,
      customerId: true,
      types: true,
      remainingAmount: true,
      currency: true,
      billingAccountId: true,
      matchSkuId: true,
      matchSkuGroupId: true,
      matchProjectId: true,
    },
    orderBy: [{ validFrom: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });

  const configsByCustomer = new Map<string, MonthlyCustomerCreditConfig[]>();
  for (const credit of credits) {
    const configs = configsByCustomer.get(credit.customerId) ?? [];
    configs.push({
      id: credit.id,
      types: credit.types,
      remainingAmount: credit.remainingAmount,
      currency: credit.currency,
      billingAccountId: credit.billingAccountId,
      matchSkuId: credit.matchSkuId,
      matchSkuGroupId: credit.matchSkuGroupId,
      matchProjectId: credit.matchProjectId,
    });
    configsByCustomer.set(credit.customerId, configs);
  }

  return new Map(Array.from(configsByCustomer.entries()).map(([customerId, configs]) => (
    [customerId, createMonthlyProviderCreditAllocator(configs)]
  )));
}

function allocateProviderCreditsForItem(params: {
  item: MonthlyBillingGroup;
  customerId: string | undefined;
  skuGroupMappings: Map<string, SkuGroupMappingForExport[]>;
  allocators: Map<string, MonthlyProviderCreditAllocator>;
}): MonthlyProviderCreditAllocation {
  if (!params.customerId) {
    return { amount: new Prisma.Decimal(0), convertedAmount: new Prisma.Decimal(0) };
  }
  const allocator = params.allocators.get(params.customerId);
  if (!allocator) {
    return { amount: new Prisma.Decimal(0), convertedAmount: new Prisma.Decimal(0) };
  }
  const mappings = params.skuGroupMappings.get(params.item.meterId) ?? [];
  return allocator.allocate({
    accountId: params.item.accountId,
    projectId: params.item.subaccountId,
    skuId: params.item.meterId,
    skuGroupIds: mappings.map((mapping) => mapping.skuGroupId),
    currency: params.item.currency,
    breakdown: params.item.creditBreakdown,
  });
}

function buildTemplateDataRow(params: {
  item: MonthlyBillingGroup;
  customer: CustomerForTemplate | undefined;
  projectName: string | null | undefined;
  rule: PricingRuleForExport | null;
  priceBasis: PricingBasis;
  templateBasis: PricingBasis;
  providerCredit: MonthlyProviderCreditAllocation;
}): BillingTemplateRow {
  const { item, customer, projectName, rule, priceBasis, templateBasis, providerCredit } = params;
  const providerCreditAmount = providerCredit.amount;
  const listAmount = item.listCost ?? item.cost.sub(item.creditAmount);
  const resellerCost = item.cost;
  const unpricedAmounts = calculateMonthlyBillingAmounts({
    priceBasis,
    listAmount,
    resellerCost,
    providerCreditAmount,
    multiplier: new Prisma.Decimal(1),
  });
  const pricingBaseAmount = priceBasis === PricingBasis.STANDARD
    ? listAmount
    : unpricedAmounts.amountAfterCredit;
  const multiplier = selectMonthlyPricingMultiplier({
    ruleType: rule?.ruleType ?? null,
    baseAmount: pricingBaseAmount,
    discountRate: rule?.discountRate ?? null,
    tiers: Array.isArray(rule?.tiers)
      ? rule.tiers as Array<{ from: number; to?: number | null; rate?: number | null }>
      : null,
  });
  const amounts = calculateMonthlyBillingAmounts({
    priceBasis,
    listAmount,
    resellerCost,
    providerCreditAmount,
    multiplier,
  });
  const pricingUsageAmount = item.pricingUsageAmount ?? item.usageAmount;
  const isUnitPrice = rule?.ruleType === 'UNIT_PRICE' && rule.unitPrice != null;
  const unitPricedAmount = isUnitPrice ? pricingUsageAmount.mul(rule.unitPrice!) : null;
  const standardDiscountedAmount = isUnitPrice
    ? unitPricedAmount!
    : listAmount.mul(multiplier);
  const standardContractDiscount = standardDiscountedAmount.sub(listAmount);
  const finalAmount = isUnitPrice
    ? unitPricedAmount!.add(providerCreditAmount)
    : amounts.finalAmount;

  const convertedCostAfterCredit = item.resellerCostConverted != null && providerCredit.convertedAmount != null
    ? item.resellerCostConverted.add(providerCredit.convertedAmount)
    : null;
  const cnyAmount = isUnitPrice
    ? item.pricingUsageAmountConverted != null && providerCredit.convertedAmount != null
      ? item.pricingUsageAmountConverted.mul(rule.unitPrice!).add(providerCredit.convertedAmount)
      : null
    : priceBasis === PricingBasis.STANDARD
      ? item.listCostConverted != null && providerCredit.convertedAmount != null
        ? item.listCostConverted.mul(multiplier).add(providerCredit.convertedAmount)
        : null
      : convertedCostAfterCredit?.mul(multiplier) ?? null;
  const conversionRate = !finalAmount.isZero() && cnyAmount != null
    ? cnyAmount.div(finalAmount)
    : item.currencyConversionRate;

  if (templateBasis === PricingBasis.STANDARD) {
    return [
      customer?.externalId || customer?.name || '',
      item.accountId,
      item.billingAccountName ?? '',
      item.projectName ?? projectName ?? item.subaccountId ?? '',
      item.subaccountId ?? '',
      item.serviceDescription ?? item.productId,
      item.productId,
      item.skuDescription ?? item.meterId,
      item.meterId,
      '',
      '',
      formatDate(item.usageStartTime),
      formatDate(item.usageEndTime),
      Number(pricingUsageAmount),
      item.pricingUsageUnit ?? item.usageUnit,
      item.currency,
      formatMoneyCell(listAmount),
      discountLabel(rule, priceBasis, multiplier),
      formatMoneyCell(standardContractDiscount),
      formatMoneyCell(standardDiscountedAmount),
      formatMoneyCell(amounts.voucherAmount),
      formatMoneyCell(finalAmount),
      formatMoneyCell(cnyAmount),
      item.transactionType ?? '',
      '',
    ];
  }

  return [
    customer?.externalId || customer?.name || '',
    item.accountId,
    item.billingAccountName ?? '',
    item.projectName ?? projectName ?? item.subaccountId ?? '',
    item.subaccountId ?? '',
    item.serviceDescription ?? item.productId,
    item.productId,
    item.skuDescription ?? item.meterId,
    item.meterId,
    formatDate(item.usageStartTime),
    formatDate(item.usageEndTime),
    Number(pricingUsageAmount),
    item.pricingUsageUnit ?? item.usageUnit,
    item.currency,
    formatMoneyCell(listAmount),
    formatMoneyCell(resellerCost),
    formatMoneyCell(amounts.voucherAmount),
    formatMoneyCell(amounts.amountAfterCredit),
    discountLabel(rule, priceBasis, multiplier),
    formatMoneyCell(finalAmount),
    formatMoneyCell(cnyAmount),
    item.transactionType ?? '',
    formatMoneyCell(conversionRate),
  ];
}

export async function buildBillingTemplateRowsForMonth(
  options: TemplateBuildOptions
): Promise<BillingTemplateBuildResult> {
  const page = Math.max(options.page ?? 1, 1);
  const requestedLimit = Math.min(Math.max(options.limit ?? 50, 1), 5000);
  const selectedTemplateBasis = options.priceBasis
    ?? (options.customerId
      ? await loadTemplateBasisForCustomer(options.customerId)
      : PricingBasis.COST);

  const overrideRows = await buildOverrideTemplateRowsForMonth({
    billingMonth: options.billingMonth,
    customerId: options.customerId,
    customerIds: options.customerIds,
    page,
    limit: requestedLimit,
    all: options.all,
  });
  if (overrideRows) {
    if (!options.customerId && !options.priceBasis) throw new MonthlyBillingCustomerSelectionError();
    if (options.priceBasis && overrideRows.headers !== headersForTemplate(options.priceBasis)) {
      const storedBasis = overrideRows.headers === STANDARD_TEMPLATE_HEADERS
        ? PricingBasis.STANDARD
        : PricingBasis.COST;
      throw new MonthlyBillingOverrideBasisMismatchError(storedBasis, options.priceBasis);
    }
    return overrideRows;
  }

  const projectCustomers = await getActiveProjectCustomers(
    options.billingMonth,
    options.customerId,
    options.customerIds
  );
  const projectIds = Array.from(projectCustomers.keys());

  if (projectIds.length === 0) {
    const headers = headersForTemplate(selectedTemplateBasis);
    return {
      headers,
      rows: [headerRow(headers)],
      total: 0,
      page,
      limit: requestedLimit,
      totalPages: 0,
    };
  }

  const loadedItems = await loadMergedBillingGroups({
    billingMonth: options.billingMonth,
    projectIds,
  });
  const projectConfigs = await prisma.projectBillingConfig.findMany({
    where: { projectId: { in: projectIds } },
    select: { projectId: true, name: true },
  });
  const customerIds = Array.from(new Set(Array.from(projectCustomers.values()).map((c) => c.id)));
  const [pricingByCustomer, creditAllocators] = await Promise.all([
    loadPricingRulesForCustomers(customerIds),
    loadMonthlyCreditAllocatorsForCustomers(customerIds, options.billingMonth),
  ]);
  const mergedItems = loadedItems.filter((item) => {
    const customer = item.subaccountId ? projectCustomers.get(item.subaccountId) : undefined;
    if (!customer) return false;
    return matchesPricingBillingAccount(
      pricingByCustomer.get(customer.id)?.billingAccountIds ?? [],
      item.accountId
    );
  });
  const total = mergedItems.length;
  const skuGroupMappings = await loadSkuGroupMappingsForSkuIds(
    mergedItems.map((item) => item.meterId)
  );
  const providerCreditByGroup = new Map<string, MonthlyProviderCreditAllocation>();
  for (const item of mergedItems) {
    const customer = item.subaccountId ? projectCustomers.get(item.subaccountId) : undefined;
    providerCreditByGroup.set(monthlyGroupKey(item), allocateProviderCreditsForItem({
      item,
      customerId: customer?.id,
      skuGroupMappings,
      allocators: creditAllocators,
    }));
  }
  const lineItems = options.all
    ? mergedItems
    : mergedItems.slice((page - 1) * requestedLimit, page * requestedLimit);
  const limit = options.all ? Math.max(total, 1) : requestedLimit;

  const [year, month] = options.billingMonth.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));
  const projectNameById = new Map(projectConfigs.map((project) => [project.projectId, project.name]));
  const templateBasis = options.priceBasis
    ?? (options.customerId
      ? selectedTemplateBasis
      : workbookTemplateBasis(customerIds, pricingByCustomer));
  const headers = headersForTemplate(templateBasis);
  const rows: BillingTemplateRow[] = [headerRow(headers)];

  for (const item of lineItems) {
    const customer = item.subaccountId ? projectCustomers.get(item.subaccountId) : undefined;
    const mappings = skuGroupMappings.get(item.meterId) ?? [];
    const pricing = customer ? pricingByCustomer.get(customer.id) : undefined;
    const rule = selectRule(
      pricing?.rules ?? [],
      mappings.map((mapping) => mapping.skuGroupId),
      monthStart,
      monthEnd
    );
    rows.push(buildTemplateDataRow({
      item,
      customer,
      projectName: item.subaccountId ? projectNameById.get(item.subaccountId) : null,
      rule,
      priceBasis: pricing?.priceBasis ?? DEFAULT_MONTHLY_PRICING_BASIS,
      templateBasis,
      providerCredit: providerCreditByGroup.get(monthlyGroupKey(item))
        ?? { amount: new Prisma.Decimal(0), convertedAmount: new Prisma.Decimal(0) },
    }));
  }

  return {
    headers,
    rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export function generateXLSXContent(rows: BillingTemplateRow[]): Buffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: false });
  const headers = (rows[0] ?? []).map((value) => String(value ?? ''));
  const numericHeaders = new Set([
    '使用量',
    '列表价',
    '经销商价',
    '代金券减免',
    '代金券减免后金额',
    '合同优惠金额',
    '优惠后金额',
    '最终付款金额',
    '折后总金额(CNY,不含税)',
    '汇率',
  ]);
  for (let column = 0; column < headers.length; column += 1) {
    if (!numericHeaders.has(headers[column])) continue;
    for (let row = 1; row < rows.length; row += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell?.t === 'n') cell.z = 'General';
    }
  }

  const widthByHeader: Record<string, number> = {
    '公司名称': 14,
    '账单账号ID': 20,
    '账单名称': 18,
    '标签': 18,
    '项目名称': 24,
    '项目ID': 24,
    '服务描述': 28,
    '服务ID': 16,
    'SKU描述': 44,
    'SKUid': 18,
    '资源名称': 20,
    '资源唯一标识符': 24,
    '使用开始时间': 14,
    '使用结束时间': 14,
    '使用量': 16,
    '用量单位': 12,
    '费用单位': 10,
    'Discount/Price': 20,
    'transaction_type': 18,
    '收费类型': 14,
  };
  worksheet['!cols'] = headers.map((header) => ({
    wch: widthByHeader[header] ?? (numericHeaders.has(header) ? 18 : 16),
  }));
  const lastColumn = XLSX.utils.encode_col(Math.max(headers.length - 1, 0));
  worksheet['!autofilter'] = { ref: `A1:${lastColumn}${Math.max(rows.length, 1)}` };

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Billing');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * Export invoice to XLSX format.
 *
 * The presentation/breakdown arguments are kept for API compatibility with the
 * other exporters; XLSX now uses invoiceId so it can expand raw billing rows.
 */
export async function exportToXLSX(
  presentation: InvoicePresentation,
  options: ExportOptions = { format: 'xlsx' },
  _creditsBreakdown?: CreditBreakdown[],
  _pricingBreakdown?: PricingBreakdown,
  invoiceId?: string
): Promise<ExportResult> {
  if (!invoiceId) {
    throw new Error('invoiceId is required for XLSX billing template export');
  }

  const { invoiceNumber, rows } = await buildBillingTemplateRows(invoiceId);
  const buffer = generateXLSXContent(rows);
  const contentHash = generateContentHash(buffer);
  const filename = `billing-${invoiceNumber}-${formatDate(new Date())}.xlsx`;

  return {
    content: buffer,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename,
    contentHash,
    metadata: {
      format: options.format,
      rowCount: Math.max(rows.length - 1, 0),
      generatedAt: new Date(),
      invoiceNumber: presentation.header.invoiceNumber,
    },
  };
}
