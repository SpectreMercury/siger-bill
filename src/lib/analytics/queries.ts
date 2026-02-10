/**
 * Analytics Queries (Phase 7)
 *
 * Read-only queries for the billing analytics dashboard.
 * All queries support scoping for permission-based access.
 */

import { prisma } from '@/lib/db';
import { BillingProvider, Prisma } from '@prisma/client';

/**
 * Scope options for filtering analytics data
 */
export interface AnalyticsScope {
  /** Limit to specific customer IDs */
  customerIds?: string[];
  /** Limit to specific provider */
  provider?: BillingProvider;
  /** Start month (inclusive) YYYY-MM */
  startMonth?: string;
  /** End month (inclusive) YYYY-MM */
  endMonth?: string;
}

/**
 * Dashboard overview KPIs
 */
export interface DashboardOverview {
  currentMonth: string;
  totalRevenue: string;
  totalCustomers: number;
  totalInvoices: number;
  avgRevenuePerCustomer: string;
  momGrowth: string;
  topProducts: Array<{ productGroup: string; amount: string; percentage: string }>;
  providerMix: Array<{ provider: string; amount: string; percentage: string }>;
}

/**
 * Get dashboard overview for the current or specified month
 */
export async function getDashboardOverview(
  month?: string,
  scope?: AnalyticsScope
): Promise<DashboardOverview> {
  const targetMonth = month || getCurrentMonth();

  // Build customer filter
  const customerFilter = scope?.customerIds?.length
    ? { customerId: { in: scope.customerIds } }
    : {};

  const providerFilter = scope?.provider
    ? { provider: scope.provider }
    : {};

  // Get customer snapshots for the month
  const customerSnapshots = await prisma.billingCustomerSnapshot.findMany({
    where: {
      month: targetMonth,
      ...customerFilter,
    },
  });

  // Get monthly summaries for product breakdown
  const monthlySummaries = await prisma.billingMonthlySummary.findMany({
    where: {
      month: targetMonth,
      ...customerFilter,
      ...providerFilter,
    },
  });

  // Calculate totals
  let totalRevenue = new Prisma.Decimal(0);
  let prevMonthTotal = new Prisma.Decimal(0);
  let totalInvoices = 0;

  for (const snapshot of customerSnapshots) {
    totalRevenue = totalRevenue.add(snapshot.totalFinalAmount);
    if (snapshot.prevMonthAmount) {
      prevMonthTotal = prevMonthTotal.add(snapshot.prevMonthAmount);
    }
    totalInvoices += snapshot.invoiceCount;
  }

  // Calculate MoM growth
  let momGrowth = '0.00';
  if (!prevMonthTotal.isZero()) {
    momGrowth = totalRevenue
      .sub(prevMonthTotal)
      .div(prevMonthTotal)
      .mul(100)
      .toFixed(2);
  }

  // Aggregate by product group
  const productTotals = new Map<string, Prisma.Decimal>();
  for (const summary of monthlySummaries) {
    const current = productTotals.get(summary.productGroup) || new Prisma.Decimal(0);
    productTotals.set(summary.productGroup, current.add(summary.finalAmount));
  }

  const topProducts = Array.from(productTotals.entries())
    .map(([productGroup, amount]) => ({
      productGroup,
      amount: amount.toString(),
      percentage: totalRevenue.isZero() ? '0' : amount.div(totalRevenue).mul(100).toFixed(2),
    }))
    .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount))
    .slice(0, 5);

  // Aggregate by provider
  const providerTotals = new Map<string, Prisma.Decimal>();
  for (const summary of monthlySummaries) {
    const providerKey = summary.provider || 'OTHER';
    const current = providerTotals.get(providerKey) || new Prisma.Decimal(0);
    providerTotals.set(providerKey, current.add(summary.finalAmount));
  }

  const providerMix = Array.from(providerTotals.entries())
    .map(([provider, amount]) => ({
      provider,
      amount: amount.toString(),
      percentage: totalRevenue.isZero() ? '0' : amount.div(totalRevenue).mul(100).toFixed(2),
    }))
    .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount));

  // Calculate average revenue per customer
  const avgRevenue = customerSnapshots.length > 0
    ? totalRevenue.div(customerSnapshots.length)
    : new Prisma.Decimal(0);

  return {
    currentMonth: targetMonth,
    totalRevenue: totalRevenue.toString(),
    totalCustomers: customerSnapshots.length,
    totalInvoices,
    avgRevenuePerCustomer: avgRevenue.toFixed(2),
    momGrowth,
    topProducts,
    providerMix,
  };
}

/**
 * Trend data point
 */
export interface TrendDataPoint {
  month: string;
  totalRevenue: string;
  totalDiscount: string;
  totalCredits: string;
  customerCount: number;
  invoiceCount: number;
}

/**
 * Get revenue trends over time
 */
export async function getRevenueTrends(
  groupBy: 'month' | 'quarter' = 'month',
  scope?: AnalyticsScope
): Promise<TrendDataPoint[]> {
  const customerFilter = scope?.customerIds?.length
    ? { customerId: { in: scope.customerIds } }
    : {};

  let monthFilter: Prisma.BillingCustomerSnapshotWhereInput = {};
  if (scope?.startMonth && scope?.endMonth) {
    monthFilter = { month: { gte: scope.startMonth, lte: scope.endMonth } };
  } else if (scope?.startMonth) {
    monthFilter = { month: { gte: scope.startMonth } };
  } else if (scope?.endMonth) {
    monthFilter = { month: { lte: scope.endMonth } };
  }

  const snapshots = await prisma.billingCustomerSnapshot.findMany({
    where: {
      ...customerFilter,
      ...monthFilter,
    },
    orderBy: { month: 'asc' },
  });

  // Group by month
  const monthlyData = new Map<string, {
    totalRevenue: Prisma.Decimal;
    totalDiscount: Prisma.Decimal;
    totalCredits: Prisma.Decimal;
    customerIds: Set<string>;
    invoiceCount: number;
  }>();

  for (const snapshot of snapshots) {
    const key = groupBy === 'quarter' ? getQuarter(snapshot.month) : snapshot.month;

    if (!monthlyData.has(key)) {
      monthlyData.set(key, {
        totalRevenue: new Prisma.Decimal(0),
        totalDiscount: new Prisma.Decimal(0),
        totalCredits: new Prisma.Decimal(0),
        customerIds: new Set(),
        invoiceCount: 0,
      });
    }

    const data = monthlyData.get(key)!;
    data.totalRevenue = data.totalRevenue.add(snapshot.totalFinalAmount);
    data.totalDiscount = data.totalDiscount.add(snapshot.totalDiscount);
    data.totalCredits = data.totalCredits.add(snapshot.totalCredits);
    data.customerIds.add(snapshot.customerId);
    data.invoiceCount += snapshot.invoiceCount;
  }

  return Array.from(monthlyData.entries())
    .map(([month, data]) => ({
      month,
      totalRevenue: data.totalRevenue.toString(),
      totalDiscount: data.totalDiscount.toString(),
      totalCredits: data.totalCredits.toString(),
      customerCount: data.customerIds.size,
      invoiceCount: data.invoiceCount,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Customer ranking data
 */
export interface CustomerRanking {
  customerId: string;
  customerName: string;
  externalId: string | null;
  totalRevenue: string;
  momGrowth: string | null;
  invoiceCount: number;
  rank: number;
}

/**
 * Get customer rankings by revenue
 */
export async function getCustomerRankings(
  month?: string,
  limit: number = 10,
  scope?: AnalyticsScope
): Promise<CustomerRanking[]> {
  const targetMonth = month || getCurrentMonth();

  const customerFilter = scope?.customerIds?.length
    ? { customerId: { in: scope.customerIds } }
    : {};

  const snapshots = await prisma.billingCustomerSnapshot.findMany({
    where: {
      month: targetMonth,
      ...customerFilter,
    },
    include: {
      customer: {
        select: {
          name: true,
          externalId: true,
        },
      },
    },
    orderBy: { totalFinalAmount: 'desc' },
    take: limit,
  });

  return snapshots.map((snapshot, index) => ({
    customerId: snapshot.customerId,
    customerName: snapshot.customer.name,
    externalId: snapshot.customer.externalId,
    totalRevenue: snapshot.totalFinalAmount.toString(),
    momGrowth: snapshot.momGrowthPct?.toString() ?? null,
    invoiceCount: snapshot.invoiceCount,
    rank: index + 1,
  }));
}

/**
 * Provider breakdown data
 */
export interface ProviderBreakdown {
  provider: string;
  totalCost: string;
  totalRevenue: string;
  marginAmount: string;
  marginPct: string | null;
  customerCount: number;
  invoiceCount: number;
}

/**
 * Get provider breakdown
 */
export async function getProviderBreakdown(
  month?: string,
  scope?: AnalyticsScope
): Promise<ProviderBreakdown[]> {
  const targetMonth = month || getCurrentMonth();

  const snapshots = await prisma.billingProviderSnapshot.findMany({
    where: {
      month: targetMonth,
    },
    orderBy: { totalRevenue: 'desc' },
  });

  return snapshots.map((snapshot) => ({
    provider: snapshot.provider || 'OTHER',
    totalCost: snapshot.totalCost.toString(),
    totalRevenue: snapshot.totalRevenue.toString(),
    marginAmount: snapshot.marginAmount.toString(),
    marginPct: snapshot.marginPct?.toString() ?? null,
    customerCount: snapshot.customerCount,
    invoiceCount: snapshot.invoiceCount,
  }));
}

/**
 * Product group breakdown data
 */
export interface ProductBreakdown {
  productGroup: string;
  listAmount: string;
  discountAmount: string;
  finalAmount: string;
  discountPct: string;
  lineItemCount: number;
  customerCount: number;
}

/**
 * Get product group breakdown
 */
export async function getProductBreakdown(
  month?: string,
  scope?: AnalyticsScope
): Promise<ProductBreakdown[]> {
  const targetMonth = month || getCurrentMonth();

  const customerFilter = scope?.customerIds?.length
    ? { customerId: { in: scope.customerIds } }
    : {};

  const providerFilter = scope?.provider
    ? { provider: scope.provider }
    : {};

  const summaries = await prisma.billingMonthlySummary.findMany({
    where: {
      month: targetMonth,
      ...customerFilter,
      ...providerFilter,
    },
  });

  // Aggregate by product group
  const productData = new Map<string, {
    listAmount: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    finalAmount: Prisma.Decimal;
    lineItemCount: number;
    customerIds: Set<string>;
  }>();

  for (const summary of summaries) {
    if (!productData.has(summary.productGroup)) {
      productData.set(summary.productGroup, {
        listAmount: new Prisma.Decimal(0),
        discountAmount: new Prisma.Decimal(0),
        finalAmount: new Prisma.Decimal(0),
        lineItemCount: 0,
        customerIds: new Set(),
      });
    }

    const data = productData.get(summary.productGroup)!;
    data.listAmount = data.listAmount.add(summary.listAmount);
    data.discountAmount = data.discountAmount.add(summary.discountAmount);
    data.finalAmount = data.finalAmount.add(summary.finalAmount);
    data.lineItemCount += summary.lineItemCount;
    data.customerIds.add(summary.customerId);
  }

  return Array.from(productData.entries())
    .map(([productGroup, data]) => ({
      productGroup,
      listAmount: data.listAmount.toString(),
      discountAmount: data.discountAmount.toString(),
      finalAmount: data.finalAmount.toString(),
      discountPct: data.listAmount.isZero()
        ? '0'
        : data.discountAmount.div(data.listAmount).mul(100).toFixed(2),
      lineItemCount: data.lineItemCount,
      customerCount: data.customerIds.size,
    }))
    .sort((a, b) => parseFloat(b.finalAmount) - parseFloat(a.finalAmount));
}

/**
 * Get available months with data
 */
export async function getAvailableMonths(): Promise<string[]> {
  const months = await prisma.billingCustomerSnapshot.findMany({
    select: { month: true },
    distinct: ['month'],
    orderBy: { month: 'desc' },
  });

  return months.map((m) => m.month);
}

/**
 * Utility: Get current month in YYYY-MM format
 */
function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Utility: Get quarter string from month
 */
function getQuarter(month: string): string {
  const [year, monthNum] = month.split('-').map(Number);
  const quarter = Math.ceil(monthNum / 3);
  return `${year}-Q${quarter}`;
}
