/**
 * XLSX Exporter (Phase 6)
 *
 * Exports invoice data in the reseller billing detail template used for
 * monthly customer billing reconciliation.
 */

import * as XLSX from 'xlsx';
import { BillingProvider, BillingSourceType, Prisma, PricingRuleType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { loadSkuGroupMappings } from '@/lib/pricing';
import {
  TEMPLATE_HEADERS,
  type BillingTemplateBuildResult,
  type BillingTemplateRow,
} from '@/lib/billing/monthly-template';
import { buildOverrideTemplateRowsForMonth } from '@/lib/billing/monthly-overrides';
import { InvoicePresentation, ExportResult, ExportOptions, CreditBreakdown, PricingBreakdown } from '../types';
import { generateContentHash } from '../builder';

type RawGcpPayload = {
  billing_account_id?: string;
  service?: { id?: string; description?: string } | null;
  sku?: { id?: string; description?: string } | null;
  project?: { id?: string; name?: string } | null;
  usage_start_time?: { value?: string } | string | null;
  usage_end_time?: { value?: string } | string | null;
  usage?: {
    amount?: number;
    unit?: string;
    amount_in_pricing_units?: number;
    pricing_unit?: string;
  } | null;
  cost_at_list?: number | string | null;
  currency_conversion_rate?: number | string | null;
  credits?: Array<{ amount?: number | string | null; type?: string | null }> | null;
  transaction_type?: string | null;
  cost_type?: string | null;
};

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

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function toDecimal(value: unknown, fallback = 0): Prisma.Decimal {
  if (value === null || value === undefined || value === '') return new Prisma.Decimal(fallback);
  try {
    return new Prisma.Decimal(value as string | number);
  } catch {
    return new Prisma.Decimal(fallback);
  }
}

function formatMoneyCell(value: Prisma.Decimal | null): string | null {
  if (value === null) return null;
  const fixed = value.toDecimalPlaces(10).toFixed(10);
  const trimmed = fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

function headerRow(): BillingTemplateRow {
  return [...TEMPLATE_HEADERS];
}

function asRawPayload(value: Prisma.JsonValue | null): RawGcpPayload {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RawGcpPayload
    : {};
}

function rawDateValue(value: RawGcpPayload['usage_start_time'], fallback: Date): string {
  if (typeof value === 'string') return value.slice(0, 10);
  if (value && typeof value === 'object' && value.value) return value.value.slice(0, 10);
  return formatDate(fallback);
}

function sumCreditAmount(raw: RawGcpPayload): Prisma.Decimal {
  if (!Array.isArray(raw.credits)) return new Prisma.Decimal(0);
  return raw.credits.reduce(
    (sum, credit) => sum.add(toDecimal(credit?.amount)),
    new Prisma.Decimal(0)
  );
}

function ruleAppliesToMonth(rule: PricingRuleForExport, monthStart: Date, monthEnd: Date): boolean {
  const effectiveStart = rule.effectiveStart ?? new Date(0);
  const effectiveEnd = rule.effectiveEnd ?? new Date('2100-01-01');
  return effectiveStart < monthEnd && effectiveEnd >= monthStart;
}

function selectRule(
  rules: PricingRuleForExport[],
  skuGroupId: string | null,
  monthStart: Date,
  monthEnd: Date
): PricingRuleForExport | null {
  const effectiveRules = rules.filter((rule) => ruleAppliesToMonth(rule, monthStart, monthEnd));
  if (skuGroupId) {
    const explicit = effectiveRules.find(
      (rule) => !rule.isDefault && rule.skuGroups.some((g) => g.skuGroup.id === skuGroupId)
    );
    if (explicit) return explicit;
  }
  return effectiveRules.find((rule) => rule.isDefault) ?? null;
}

function discountLabel(rule: PricingRuleForExport | null): string {
  if (!rule) return 'Cost * 100%';
  if (rule.ruleType === 'LIST_DISCOUNT' && rule.discountRate != null) {
    return `Cost * ${rule.discountRate.mul(100).toDecimalPlaces(4).toString()}%`;
  }
  if (rule.ruleType === 'UNIT_PRICE' && rule.unitPrice != null) {
    return `Unit Price ${rule.unitPrice.toString()}`;
  }
  if (rule.ruleType === 'TIERED') return 'TODO';
  return 'Cost * 100%';
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
    page: 1,
    limit: 5000,
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

  const lineItems = activeProjectIds.length === 0
    ? []
    : await prisma.billingLineItem.findMany({
        where: {
          provider: BillingProvider.GCP,
          sourceType: BillingSourceType.BIGQUERY_EXPORT,
          invoiceMonth: invoice.billingMonth,
          subaccountId: { in: activeProjectIds },
          ingestionBatch: { isActive: true },
        },
        orderBy: [{ usageStartTime: 'asc' }, { subaccountId: 'asc' }, { meterId: 'asc' }],
      });

  const projectConfigs = await prisma.projectBillingConfig.findMany({
    where: { projectId: { in: activeProjectIds } },
    select: { projectId: true, name: true },
  });
  const projectNameById = new Map(projectConfigs.map((project) => [project.projectId, project.name]));

  const pricingList = await prisma.pricingList.findFirst({
    where: { customerId: invoice.customerId, status: 'ACTIVE' },
    include: {
      pricingRules: {
        include: { skuGroups: { include: { skuGroup: { select: { id: true, code: true } } } } },
        orderBy: [{ isDefault: 'asc' }, { createdAt: 'desc' }],
      },
    },
  });
  const rules = pricingList?.pricingRules ?? [];
  const skuGroupMappings = await loadSkuGroupMappings();
  const companyName = invoice.customer.externalId || invoice.customer.name;

  const rows: BillingTemplateRow[] = [headerRow()];

  for (const item of lineItems) {
    const raw = asRawPayload(item.rawPayload);
    const mapping = skuGroupMappings.get(item.meterId);
    const rule = selectRule(rules, mapping?.skuGroupId ?? null, monthStart, monthEnd);
    const multiplier = rule?.ruleType === 'LIST_DISCOUNT' && rule.discountRate != null
      ? rule.discountRate
      : new Prisma.Decimal(1);
    const voucherAmount = item.creditAmount ?? sumCreditAmount(raw);
    const listAmount = raw.cost_at_list != null
      ? toDecimal(raw.cost_at_list)
      : item.listCost ?? item.cost.sub(voucherAmount);
    const resellerCost = item.cost;
    const costAfterCredit = item.costAfterCredit ?? resellerCost.add(voucherAmount);
    const finalAmount = costAfterCredit.mul(multiplier);
    const conversionRate = item.currencyConversionRate ?? (raw.currency_conversion_rate != null
      ? toDecimal(raw.currency_conversion_rate)
      : null);
    const cnyAmount = conversionRate ? finalAmount.mul(conversionRate) : null;

    rows.push([
      companyName,
      raw.billing_account_id ?? item.accountId,
      item.billingAccountName ?? '',
      item.projectName ?? raw.project?.name ?? projectNameById.get(item.subaccountId ?? '') ?? item.subaccountId ?? '',
      raw.project?.id ?? item.subaccountId ?? '',
      item.serviceDescription ?? raw.service?.description ?? item.productId,
      raw.service?.id ?? item.productId,
      item.skuDescription ?? raw.sku?.description ?? item.meterId,
      raw.sku?.id ?? item.meterId,
      rawDateValue(raw.usage_start_time, item.usageStartTime),
      rawDateValue(raw.usage_end_time, item.usageEndTime),
      item.pricingUsageAmount != null ? Number(item.pricingUsageAmount) : raw.usage?.amount_in_pricing_units ?? Number(item.usageAmount),
      item.pricingUsageUnit ?? raw.usage?.pricing_unit ?? item.usageUnit,
      item.currency,
      formatMoneyCell(listAmount),
      formatMoneyCell(resellerCost),
      formatMoneyCell(voucherAmount),
      formatMoneyCell(costAfterCredit),
      discountLabel(rule),
      formatMoneyCell(finalAmount),
      formatMoneyCell(cnyAmount),
      item.transactionType ?? raw.transaction_type ?? raw.cost_type ?? '',
      formatMoneyCell(conversionRate),
    ]);
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
  customerId?: string;
  page?: number;
  limit?: number;
};

async function getActiveProjectCustomers(
  billingMonth: string,
  customerId?: string
): Promise<Map<string, CustomerForTemplate>> {
  const bindings = await prisma.customerProject.findMany({
    where: {
      isActive: true,
      ...(customerId ? { customerId } : {}),
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
    orderBy: { updatedAt: 'desc' },
  });

  const rulesByCustomer = new Map<string, PricingRuleForExport[]>();
  for (const list of lists) {
    if (!rulesByCustomer.has(list.customerId)) {
      rulesByCustomer.set(list.customerId, list.pricingRules);
    }
  }
  return rulesByCustomer;
}

function buildTemplateDataRow(params: {
  item: Awaited<ReturnType<typeof prisma.billingLineItem.findMany>>[number];
  raw: RawGcpPayload;
  customer: CustomerForTemplate | undefined;
  projectName: string | null | undefined;
  rule: PricingRuleForExport | null;
}): BillingTemplateRow {
  const { item, raw, customer, projectName, rule } = params;
  const multiplier = rule?.ruleType === 'LIST_DISCOUNT' && rule.discountRate != null
    ? rule.discountRate
    : new Prisma.Decimal(1);
  const voucherAmount = item.creditAmount ?? sumCreditAmount(raw);
  const listAmount = raw.cost_at_list != null
    ? toDecimal(raw.cost_at_list)
    : item.listCost ?? item.cost.sub(voucherAmount);
  const resellerCost = item.cost;
  const costAfterCredit = item.costAfterCredit ?? resellerCost.add(voucherAmount);
  const finalAmount = costAfterCredit.mul(multiplier);
  const conversionRate = item.currencyConversionRate ?? (raw.currency_conversion_rate != null
    ? toDecimal(raw.currency_conversion_rate)
    : null);
  const cnyAmount = conversionRate ? finalAmount.mul(conversionRate) : null;

  return [
    customer?.externalId || customer?.name || '',
    raw.billing_account_id ?? item.accountId,
    item.billingAccountName ?? '',
    item.projectName ?? raw.project?.name ?? projectName ?? item.subaccountId ?? '',
    raw.project?.id ?? item.subaccountId ?? '',
    item.serviceDescription ?? raw.service?.description ?? item.productId,
    raw.service?.id ?? item.productId,
    item.skuDescription ?? raw.sku?.description ?? item.meterId,
    raw.sku?.id ?? item.meterId,
    rawDateValue(raw.usage_start_time, item.usageStartTime),
    rawDateValue(raw.usage_end_time, item.usageEndTime),
    item.pricingUsageAmount != null ? Number(item.pricingUsageAmount) : raw.usage?.amount_in_pricing_units ?? Number(item.usageAmount),
    item.pricingUsageUnit ?? raw.usage?.pricing_unit ?? item.usageUnit,
    item.currency,
    formatMoneyCell(listAmount),
    formatMoneyCell(resellerCost),
    formatMoneyCell(voucherAmount),
    formatMoneyCell(costAfterCredit),
    discountLabel(rule),
    formatMoneyCell(finalAmount),
    formatMoneyCell(cnyAmount),
    item.transactionType ?? raw.transaction_type ?? raw.cost_type ?? '',
    formatMoneyCell(conversionRate),
  ];
}

export async function buildBillingTemplateRowsForMonth(
  options: TemplateBuildOptions
): Promise<BillingTemplateBuildResult> {
  const page = Math.max(options.page ?? 1, 1);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 5000);

  const overrideRows = await buildOverrideTemplateRowsForMonth({
    billingMonth: options.billingMonth,
    customerId: options.customerId,
    page,
    limit,
  });
  if (overrideRows) return overrideRows;

  const projectCustomers = await getActiveProjectCustomers(options.billingMonth, options.customerId);
  const projectIds = Array.from(projectCustomers.keys());

  if (projectIds.length === 0) {
    return { rows: [headerRow()], total: 0, page, limit, totalPages: 0 };
  }

  const where: Prisma.BillingLineItemWhereInput = {
    provider: BillingProvider.GCP,
    sourceType: BillingSourceType.BIGQUERY_EXPORT,
    invoiceMonth: options.billingMonth,
    subaccountId: { in: projectIds },
    ingestionBatch: { isActive: true },
  };

  const [lineItems, total, projectConfigs, skuGroupMappings, rulesByCustomer] = await Promise.all([
    prisma.billingLineItem.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ usageStartTime: 'asc' }, { subaccountId: 'asc' }, { meterId: 'asc' }],
    }),
    prisma.billingLineItem.count({ where }),
    prisma.projectBillingConfig.findMany({
      where: { projectId: { in: projectIds } },
      select: { projectId: true, name: true },
    }),
    loadSkuGroupMappings(),
    loadPricingRulesForCustomers(Array.from(new Set(Array.from(projectCustomers.values()).map((c) => c.id)))),
  ]);

  const [year, month] = options.billingMonth.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));
  const projectNameById = new Map(projectConfigs.map((project) => [project.projectId, project.name]));
  const rows: BillingTemplateRow[] = [headerRow()];

  for (const item of lineItems) {
    const raw = asRawPayload(item.rawPayload);
    const customer = item.subaccountId ? projectCustomers.get(item.subaccountId) : undefined;
    const mapping = skuGroupMappings.get(item.meterId);
    const rules = customer ? rulesByCustomer.get(customer.id) ?? [] : [];
    const rule = selectRule(rules, mapping?.skuGroupId ?? null, monthStart, monthEnd);
    rows.push(buildTemplateDataRow({
      item,
      raw,
      customer,
      projectName: item.subaccountId ? projectNameById.get(item.subaccountId) : null,
      rule,
    }));
  }

  return {
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

  worksheet['!cols'] = [
    { wch: 14 }, { wch: 20 }, { wch: 12 }, { wch: 24 }, { wch: 24 },
    { wch: 28 }, { wch: 16 }, { wch: 44 }, { wch: 18 }, { wch: 14 },
    { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 14 },
    { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 16 },
    { wch: 22 }, { wch: 18 }, { wch: 14 },
  ];
  worksheet['!autofilter'] = { ref: `A1:W${Math.max(rows.length, 1)}` };

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
