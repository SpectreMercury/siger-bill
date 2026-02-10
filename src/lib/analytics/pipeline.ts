/**
 * Analytics Data Pipeline (Phase 7)
 *
 * Aggregates invoice data into analytics fact tables on invoice-run completion.
 * These tables are append-only for historical tracking.
 */

import { prisma } from '@/lib/db';
import { BillingProvider, Prisma } from '@prisma/client';

/**
 * Generate analytics snapshots for a completed invoice run
 *
 * Called when an invoice run transitions to SUCCEEDED status.
 * Creates:
 * - BillingMonthlySummary records (per customer, product group, provider)
 * - BillingCustomerSnapshot records (per customer)
 * - BillingProviderSnapshot records (per provider)
 */
export async function generateAnalyticsSnapshots(invoiceRunId: string): Promise<{
  monthlySummaryCount: number;
  customerSnapshotCount: number;
  providerSnapshotCount: number;
}> {
  // Load the invoice run with all invoices and line items
  const invoiceRun = await prisma.invoiceRun.findUnique({
    where: { id: invoiceRunId },
    include: {
      invoices: {
        where: { status: { not: 'CANCELLED' } },
        include: {
          lineItems: true,
          customer: true,
          creditLedgerEntries: true,
        },
      },
    },
  });

  if (!invoiceRun) {
    throw new Error(`Invoice run not found: ${invoiceRunId}`);
  }

  const billingMonth = invoiceRun.billingMonth;
  const provider = invoiceRun.provider;

  // Aggregation maps
  const monthlySummaryMap = new Map<string, {
    customerId: string;
    productGroup: string;
    provider: BillingProvider | null;
    listAmount: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    tierDiscountAmount: Prisma.Decimal;
    creditAmount: Prisma.Decimal;
    specialRulesAmount: Prisma.Decimal;
    finalAmount: Prisma.Decimal;
    usageQuantity: Prisma.Decimal;
    lineItemCount: number;
    currency: string;
  }>();

  const customerSnapshotMap = new Map<string, {
    customerId: string;
    totalListAmount: Prisma.Decimal;
    totalFinalAmount: Prisma.Decimal;
    totalDiscount: Prisma.Decimal;
    totalCredits: Prisma.Decimal;
    invoiceCount: number;
    lineItemCount: number;
    currency: string;
  }>();

  const providerSnapshotMap = new Map<string, {
    provider: BillingProvider | null;
    totalCost: Prisma.Decimal;
    totalRevenue: Prisma.Decimal;
    totalDiscount: Prisma.Decimal;
    customerIds: Set<string>;
    invoiceCount: number;
    lineItemCount: number;
    currency: string;
  }>();

  // Process each invoice
  for (const invoice of invoiceRun.invoices) {
    const customerId = invoice.customerId;
    const currency = invoice.currency === 'MIXED' ? 'USD' : invoice.currency;

    // Parse currency breakdown for pricing info
    const breakdown = invoice.currencyBreakdown as {
      pricing?: {
        rawTotal?: string;
        pricedTotal?: string;
        discount?: string;
        skuGroupBreakdown?: Record<string, {
          rawTotal: string;
          pricedTotal: string;
          entryCount: number;
        }>;
      };
      credits?: {
        totalCreditsApplied?: string;
      };
    } | null;

    // Calculate invoice-level totals
    const invoiceListAmount = breakdown?.pricing?.rawTotal
      ? new Prisma.Decimal(breakdown.pricing.rawTotal)
      : invoice.subtotal;
    const invoiceFinalAmount = invoice.totalAmount;
    const invoiceCredits = invoice.creditAmount;
    const invoiceDiscount = invoiceListAmount.sub(invoice.subtotal);

    // Update customer snapshot
    if (!customerSnapshotMap.has(customerId)) {
      customerSnapshotMap.set(customerId, {
        customerId,
        totalListAmount: new Prisma.Decimal(0),
        totalFinalAmount: new Prisma.Decimal(0),
        totalDiscount: new Prisma.Decimal(0),
        totalCredits: new Prisma.Decimal(0),
        invoiceCount: 0,
        lineItemCount: 0,
        currency,
      });
    }
    const customerData = customerSnapshotMap.get(customerId)!;
    customerData.totalListAmount = customerData.totalListAmount.add(invoiceListAmount);
    customerData.totalFinalAmount = customerData.totalFinalAmount.add(invoiceFinalAmount);
    customerData.totalDiscount = customerData.totalDiscount.add(invoiceDiscount);
    customerData.totalCredits = customerData.totalCredits.add(invoiceCredits);
    customerData.invoiceCount++;

    // Update provider snapshot
    const providerKey = provider || 'MULTI';
    if (!providerSnapshotMap.has(providerKey)) {
      providerSnapshotMap.set(providerKey, {
        provider: provider,
        totalCost: new Prisma.Decimal(0),
        totalRevenue: new Prisma.Decimal(0),
        totalDiscount: new Prisma.Decimal(0),
        customerIds: new Set(),
        invoiceCount: 0,
        lineItemCount: 0,
        currency,
      });
    }
    const providerData = providerSnapshotMap.get(providerKey)!;
    providerData.totalCost = providerData.totalCost.add(invoiceListAmount);
    providerData.totalRevenue = providerData.totalRevenue.add(invoiceFinalAmount);
    providerData.totalDiscount = providerData.totalDiscount.add(invoiceDiscount);
    providerData.customerIds.add(customerId);
    providerData.invoiceCount++;

    // Process line items for monthly summary
    for (const lineItem of invoice.lineItems) {
      const metadata = lineItem.metadata as {
        skuGroupCode?: string;
        rawAmount?: string;
        pricedAmount?: string;
        entryCount?: number;
        provider?: string;
      } | null;

      const productGroup = metadata?.skuGroupCode || 'OTHER';
      const summaryKey = `${customerId}:${productGroup}:${provider || 'MULTI'}`;

      const rawAmount = metadata?.rawAmount
        ? new Prisma.Decimal(metadata.rawAmount)
        : lineItem.amount;
      const pricedAmount = metadata?.pricedAmount
        ? new Prisma.Decimal(metadata.pricedAmount)
        : lineItem.amount;
      const discount = rawAmount.sub(pricedAmount);

      if (!monthlySummaryMap.has(summaryKey)) {
        monthlySummaryMap.set(summaryKey, {
          customerId,
          productGroup,
          provider: provider,
          listAmount: new Prisma.Decimal(0),
          discountAmount: new Prisma.Decimal(0),
          tierDiscountAmount: new Prisma.Decimal(0),
          creditAmount: new Prisma.Decimal(0),
          specialRulesAmount: new Prisma.Decimal(0),
          finalAmount: new Prisma.Decimal(0),
          usageQuantity: new Prisma.Decimal(0),
          lineItemCount: 0,
          currency,
        });
      }

      const summaryData = monthlySummaryMap.get(summaryKey)!;
      summaryData.listAmount = summaryData.listAmount.add(rawAmount);
      summaryData.discountAmount = summaryData.discountAmount.add(discount);
      summaryData.finalAmount = summaryData.finalAmount.add(pricedAmount);
      summaryData.usageQuantity = summaryData.usageQuantity.add(lineItem.quantity);
      summaryData.lineItemCount += metadata?.entryCount || 1;

      // Update customer line item count
      customerData.lineItemCount += metadata?.entryCount || 1;
      providerData.lineItemCount += metadata?.entryCount || 1;
    }
  }

  // Get previous month data for MoM calculations
  const prevMonth = getPreviousMonth(billingMonth);
  const prevCustomerSnapshots = await prisma.billingCustomerSnapshot.findMany({
    where: { month: prevMonth },
    select: { customerId: true, totalFinalAmount: true },
  });
  const prevCustomerAmounts = new Map(
    prevCustomerSnapshots.map((s) => [s.customerId, s.totalFinalAmount])
  );

  // Create records in transaction
  const result = await prisma.$transaction(async (tx) => {
    // Delete existing records for this invoice run (idempotency)
    await tx.billingMonthlySummary.deleteMany({ where: { invoiceRunId } });
    await tx.billingCustomerSnapshot.deleteMany({ where: { invoiceRunId } });
    await tx.billingProviderSnapshot.deleteMany({ where: { invoiceRunId } });

    // Create monthly summaries
    const monthlySummaries: Prisma.BillingMonthlySummaryCreateManyInput[] = [];
    monthlySummaryMap.forEach((data) => {
      monthlySummaries.push({
        invoiceRunId,
        month: billingMonth,
        provider: data.provider,
        customerId: data.customerId,
        productGroup: data.productGroup,
        listAmount: data.listAmount,
        discountAmount: data.discountAmount,
        tierDiscountAmount: data.tierDiscountAmount,
        creditAmount: data.creditAmount,
        specialRulesAmount: data.specialRulesAmount,
        finalAmount: data.finalAmount,
        usageQuantity: data.usageQuantity,
        lineItemCount: data.lineItemCount,
        currency: data.currency,
      });
    });

    if (monthlySummaries.length > 0) {
      await tx.billingMonthlySummary.createMany({ data: monthlySummaries });
    }

    // Create customer snapshots
    const customerSnapshots: Prisma.BillingCustomerSnapshotCreateManyInput[] = [];
    customerSnapshotMap.forEach((data) => {
      const prevAmount = prevCustomerAmounts.get(data.customerId);
      let momGrowthPct: Prisma.Decimal | null = null;

      if (prevAmount && !prevAmount.isZero()) {
        momGrowthPct = data.totalFinalAmount
          .sub(prevAmount)
          .div(prevAmount)
          .mul(100);
      }

      // Calculate gross margin (simplified - revenue vs cost)
      // In real implementation, you'd have actual cost data
      let grossMarginPct: Prisma.Decimal | null = null;
      if (!data.totalListAmount.isZero()) {
        grossMarginPct = data.totalFinalAmount
          .sub(data.totalListAmount.mul(new Prisma.Decimal(0.7))) // Assume 70% cost
          .div(data.totalFinalAmount)
          .mul(100);
      }

      customerSnapshots.push({
        invoiceRunId,
        month: billingMonth,
        customerId: data.customerId,
        totalListAmount: data.totalListAmount,
        totalFinalAmount: data.totalFinalAmount,
        totalDiscount: data.totalDiscount,
        totalCredits: data.totalCredits,
        grossMarginPct,
        momGrowthPct,
        prevMonthAmount: prevAmount ?? null,
        invoiceCount: data.invoiceCount,
        lineItemCount: data.lineItemCount,
        currency: data.currency,
      });
    });

    if (customerSnapshots.length > 0) {
      await tx.billingCustomerSnapshot.createMany({ data: customerSnapshots });
    }

    // Create provider snapshots
    const providerSnapshots: Prisma.BillingProviderSnapshotCreateManyInput[] = [];
    providerSnapshotMap.forEach((data) => {
      const marginAmount = data.totalRevenue.sub(data.totalCost.mul(new Prisma.Decimal(0.7)));
      let marginPct: Prisma.Decimal | null = null;
      if (!data.totalRevenue.isZero()) {
        marginPct = marginAmount.div(data.totalRevenue).mul(100);
      }

      providerSnapshots.push({
        invoiceRunId,
        month: billingMonth,
        provider: data.provider,
        totalCost: data.totalCost,
        totalRevenue: data.totalRevenue,
        totalDiscount: data.totalDiscount,
        marginAmount,
        marginPct,
        customerCount: data.customerIds.size,
        invoiceCount: data.invoiceCount,
        lineItemCount: data.lineItemCount,
        currency: data.currency,
      });
    });

    if (providerSnapshots.length > 0) {
      await tx.billingProviderSnapshot.createMany({ data: providerSnapshots });
    }

    return {
      monthlySummaryCount: monthlySummaries.length,
      customerSnapshotCount: customerSnapshots.length,
      providerSnapshotCount: providerSnapshots.length,
    };
  });

  console.log(
    `Analytics snapshots generated for invoice run ${invoiceRunId}: ` +
    `${result.monthlySummaryCount} summaries, ${result.customerSnapshotCount} customer snapshots, ` +
    `${result.providerSnapshotCount} provider snapshots`
  );

  return result;
}

/**
 * Get the previous month in YYYY-MM format
 */
function getPreviousMonth(month: string): string {
  const [year, monthNum] = month.split('-').map(Number);
  if (monthNum === 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${String(monthNum - 1).padStart(2, '0')}`;
}

/**
 * Rebuild analytics snapshots for a specific month
 * Useful for backfilling or correcting data
 */
export async function rebuildAnalyticsForMonth(month: string): Promise<void> {
  // Find all completed invoice runs for this month
  const invoiceRuns = await prisma.invoiceRun.findMany({
    where: {
      billingMonth: month,
      status: 'SUCCEEDED',
    },
    select: { id: true },
  });

  console.log(`Rebuilding analytics for ${month}: ${invoiceRuns.length} invoice runs`);

  for (const run of invoiceRuns) {
    await generateAnalyticsSnapshots(run.id);
  }
}
