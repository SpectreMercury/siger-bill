/**
 * Invoice Presentation Builder (Phase 6)
 *
 * Transforms engine outputs into human-readable, finance-grade
 * invoice presentations with aggregation support.
 */

import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import crypto from 'crypto';
import {
  AggregationLevel,
  PresentationRow,
  InvoiceSummary,
  InvoicePresentation,
  CreditBreakdown,
  PricingBreakdown,
} from './types';

/**
 * Default billing entity configuration
 * In production, this should come from environment or database
 */
const DEFAULT_BILLING_ENTITY = {
  name: 'Sieger Cloud Services',
  address: '123 Cloud Street, Tech City, TC 12345',
  taxId: 'TAX-123456789',
  bankDetails: 'Bank: Cloud National | Account: 1234567890 | Routing: 987654321',
};

/**
 * Build a complete invoice presentation from an invoice ID
 */
export async function buildInvoicePresentation(
  invoiceId: string,
  aggregationLevel: AggregationLevel = 'product_group'
): Promise<InvoicePresentation> {
  // Load invoice with all related data
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: true,
      lineItems: {
        orderBy: { lineNumber: 'asc' },
      },
      invoiceRun: {
        include: {
          configSnapshot: true,
        },
      },
    },
  });

  if (!invoice) {
    throw new Error(`Invoice not found: ${invoiceId}`);
  }

  // Load credit applications for this invoice
  const creditApplications = await prisma.creditLedger.findMany({
    where: {
      invoiceId: invoiceId,
    },
    include: {
      credit: true,
    },
  });

  // Parse currency breakdown from invoice metadata
  const currencyBreakdown = invoice.currencyBreakdown as {
    currencies?: Array<{ currency: string; rawAmount: string }>;
    pricing?: {
      pricingListId?: string;
      rawTotal?: string;
      pricedTotal?: string;
      discount?: string;
      skuGroupBreakdown?: Record<string, {
        rawTotal: string;
        pricedTotal: string;
        entryCount: number;
        ruleId: string | null;
        discountRate: string | null;
      }>;
      rulesUsed?: Array<{ ruleId: string; skuGroupCode: string; discountRate: string }>;
    };
    credits?: {
      totalCreditsApplied?: string;
      creditsUsed?: Array<{ creditId: string; creditType: string; appliedAmount: string }>;
    };
  } | null;

  // Build aggregated rows
  const rows = buildAggregatedRows(invoice.lineItems, currencyBreakdown, aggregationLevel);

  // Calculate summary
  const summary = calculateSummary(invoice, rows, currencyBreakdown);

  // Build credit breakdown
  const creditBreakdown = buildCreditBreakdown(creditApplications);

  // Build presentation
  const presentation: InvoicePresentation = {
    header: {
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.issueDate ?? new Date(),
      dueDate: invoice.dueDate ?? new Date(),
      billingMonth: invoice.billingMonth,
      status: invoice.status,
    },
    customer: {
      id: invoice.customer.id,
      name: invoice.customer.name,
      externalId: invoice.customer.externalId ?? undefined,
      contactEmail: invoice.customer.primaryContactEmail ?? undefined,
    },
    billingEntity: DEFAULT_BILLING_ENTITY,
    rows,
    summary,
    paymentTerms: {
      days: invoice.customer.paymentTermsDays,
      instructions: 'Payment due within the specified terms. Please reference invoice number in payment.',
    },
    notes: invoice.notes ?? undefined,
    terms: 'Standard terms and conditions apply. Late payments may incur additional fees.',
    audit: {
      invoiceRunId: invoice.invoiceRunId,
      generatedAt: new Date(),
      configSnapshotId: invoice.invoiceRun.configSnapshotId ?? undefined,
    },
  };

  return presentation;
}

/**
 * Build aggregated rows from line items
 */
function buildAggregatedRows(
  lineItems: Array<{
    id: string;
    lineNumber: number;
    description: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    amount: Prisma.Decimal;
    metadata: Prisma.JsonValue;
  }>,
  currencyBreakdown: unknown,
  aggregationLevel: AggregationLevel
): PresentationRow[] {
  const rows: PresentationRow[] = [];

  // Group line items based on aggregation level
  const groups = new Map<string, typeof lineItems>();

  for (const item of lineItems) {
    const metadata = item.metadata as {
      skuGroupCode?: string;
      rawAmount?: string;
      pricedAmount?: string;
      entryCount?: number;
      ruleId?: string | null;
      discountRate?: string | null;
      provider?: string;
      service?: string;
    } | null;

    let groupKey: string;
    switch (aggregationLevel) {
      case 'product_group':
        groupKey = metadata?.skuGroupCode || 'OTHER';
        break;
      case 'provider':
        groupKey = metadata?.provider || 'UNKNOWN';
        break;
      case 'service':
        groupKey = metadata?.service || metadata?.skuGroupCode || 'OTHER';
        break;
      case 'sku':
        // For SKU level, each line item is its own group
        groupKey = item.id;
        break;
      default:
        groupKey = metadata?.skuGroupCode || 'OTHER';
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(item);
  }

  // Convert groups to presentation rows
  let rowIndex = 0;
  groups.forEach((items, groupKey) => {
    rowIndex++;
    const firstItem = items[0];
    const metadata = firstItem.metadata as {
      skuGroupCode?: string;
      rawAmount?: string;
      pricedAmount?: string;
      entryCount?: number;
      ruleId?: string | null;
      discountRate?: string | null;
      provider?: string;
      service?: string;
    } | null;

    // Aggregate amounts
    let totalListAmount = new Prisma.Decimal(0);
    let totalPricedAmount = new Prisma.Decimal(0);
    let totalQuantity = new Prisma.Decimal(0);
    let totalEntryCount = 0;

    for (const item of items) {
      const itemMeta = item.metadata as typeof metadata;
      const rawAmount = itemMeta?.rawAmount ? new Prisma.Decimal(itemMeta.rawAmount) : item.amount;
      const pricedAmount = itemMeta?.pricedAmount ? new Prisma.Decimal(itemMeta.pricedAmount) : item.amount;

      totalListAmount = totalListAmount.add(rawAmount);
      totalPricedAmount = totalPricedAmount.add(pricedAmount);
      totalQuantity = totalQuantity.add(item.quantity);
      totalEntryCount += itemMeta?.entryCount || 1;
    }

    const discountAmount = totalListAmount.sub(totalPricedAmount);

    // Build description
    let description = groupKey;
    if (groupKey === 'UNMAPPED') {
      description = 'Other Services (Unmapped SKUs)';
    } else if (aggregationLevel === 'product_group') {
      description = `${groupKey} Services`;
    }

    const row: PresentationRow = {
      rowId: `row-${rowIndex}`,
      groupKey,
      groupType: aggregationLevel,
      description,
      productGroup: metadata?.skuGroupCode || groupKey,
      provider: metadata?.provider,
      service: metadata?.service,
      usage: {
        quantity: totalQuantity,
        unit: 'units',
        period: {
          start: new Date(), // Would come from actual line item data
          end: new Date(),
        },
      },
      amounts: {
        listAmount: totalListAmount,
        discountAmount,
        tierDiscountAmount: new Prisma.Decimal(0), // TODO: Extract from tier pricing
        creditApplied: new Prisma.Decimal(0), // Applied at invoice level
        specialRulesAdjustment: new Prisma.Decimal(0), // TODO: Extract from special rules
        netAmount: totalPricedAmount,
      },
      currency: 'USD', // Would come from invoice
      itemCount: totalEntryCount,
      metadata: {
        pricingRuleId: metadata?.ruleId ?? undefined,
        discountRate: metadata?.discountRate ?? undefined,
      },
    };

    rows.push(row);
  });

  return rows;
}

/**
 * Calculate invoice summary totals
 */
function calculateSummary(
  invoice: {
    subtotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    creditAmount: Prisma.Decimal;
    currency: string;
  },
  rows: PresentationRow[],
  currencyBreakdown: unknown
): InvoiceSummary {
  // Calculate totals from rows
  let subtotal = new Prisma.Decimal(0);
  let totalDiscount = new Prisma.Decimal(0);
  let totalTierDiscount = new Prisma.Decimal(0);
  let totalSpecialRulesAdjustment = new Prisma.Decimal(0);

  for (const row of rows) {
    subtotal = subtotal.add(row.amounts.listAmount);
    totalDiscount = totalDiscount.add(row.amounts.discountAmount);
    totalTierDiscount = totalTierDiscount.add(row.amounts.tierDiscountAmount);
    totalSpecialRulesAdjustment = totalSpecialRulesAdjustment.add(row.amounts.specialRulesAdjustment);
  }

  // Parse multi-currency breakdown
  const breakdown = currencyBreakdown as {
    currencies?: Array<{ currency: string; rawAmount: string }>;
  } | null;

  const currencyBreakdownMap: Record<string, { subtotal: string; netAmount: string }> = {};
  if (breakdown?.currencies) {
    for (const curr of breakdown.currencies) {
      currencyBreakdownMap[curr.currency] = {
        subtotal: curr.rawAmount,
        netAmount: curr.rawAmount, // Simplified - would need per-currency calculations
      };
    }
  }

  return {
    subtotal,
    totalDiscount,
    totalTierDiscount,
    totalCredits: invoice.creditAmount,
    totalSpecialRulesAdjustment,
    taxAmount: invoice.taxAmount,
    grandTotal: invoice.totalAmount,
    currency: invoice.currency,
    currencyBreakdown: Object.keys(currencyBreakdownMap).length > 0 ? currencyBreakdownMap : undefined,
  };
}

/**
 * Build credit breakdown from ledger entries
 */
function buildCreditBreakdown(
  creditApplications: Array<{
    appliedAmount: Prisma.Decimal;
    credit: {
      id: string;
      type: string;
      description: string | null;
      totalAmount: Prisma.Decimal;
      remainingAmount: Prisma.Decimal;
      validTo: Date;
    };
  }>
): CreditBreakdown[] {
  return creditApplications.map((app) => ({
    creditId: app.credit.id,
    creditType: app.credit.type,
    description: app.credit.description || 'Credit',
    originalAmount: app.credit.totalAmount,
    appliedAmount: app.appliedAmount,
    remainingAmount: app.credit.remainingAmount,
    expiresAt: app.credit.validTo,
  }));
}

/**
 * Get pricing breakdown for an invoice
 */
export async function getPricingBreakdown(invoiceId: string): Promise<PricingBreakdown | null> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      currencyBreakdown: true,
      customerId: true,
    },
  });

  if (!invoice) {
    return null;
  }

  const breakdown = invoice.currencyBreakdown as {
    pricing?: {
      pricingListId?: string;
      skuGroupBreakdown?: Record<string, {
        rawTotal: string;
        pricedTotal: string;
        ruleId: string | null;
        discountRate: string | null;
      }>;
      rulesUsed?: Array<{ ruleId: string; skuGroupCode: string; discountRate: string }>;
    };
  } | null;

  if (!breakdown?.pricing?.pricingListId) {
    return null;
  }

  // Get pricing list name
  const pricingList = await prisma.pricingList.findUnique({
    where: { id: breakdown.pricing.pricingListId },
    select: { name: true },
  });

  const rules: PricingBreakdown['rules'] = [];
  if (breakdown.pricing.skuGroupBreakdown) {
    for (const [skuGroupCode, data] of Object.entries(breakdown.pricing.skuGroupBreakdown)) {
      const rawAmount = new Prisma.Decimal(data.rawTotal);
      const finalAmount = new Prisma.Decimal(data.pricedTotal);
      const discountAmount = rawAmount.sub(finalAmount);

      rules.push({
        ruleId: data.ruleId || '',
        skuGroupCode,
        discountType: data.discountRate ? 'LIST_DISCOUNT' : 'NONE',
        discountRate: data.discountRate || '0',
        rawAmount: data.rawTotal,
        discountAmount: discountAmount.toString(),
        finalAmount: data.pricedTotal,
      });
    }
  }

  return {
    pricingListId: breakdown.pricing.pricingListId,
    pricingListName: pricingList?.name || 'Unknown',
    rules,
  };
}

/**
 * Get credits breakdown for an invoice
 */
export async function getCreditsBreakdown(invoiceId: string): Promise<CreditBreakdown[]> {
  const creditApplications = await prisma.creditLedger.findMany({
    where: {
      invoiceId: invoiceId,
    },
    include: {
      credit: true,
    },
  });

  return buildCreditBreakdown(creditApplications);
}

/**
 * Generate a content hash for audit purposes
 */
export function generateContentHash(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
