/**
 * Credits Engine (Phase 3.3 — extended with scope filters)
 *
 * Handles credit application to invoices during invoice runs.
 *
 * Each credit can optionally narrow its applicability via three nullable
 * filters (combined with AND, empty = match anything):
 *   - matchSkuId        → matches one specific GCP SKU id
 *   - matchSkuGroupId   → matches all SKUs in this SkuGroup
 *   - matchProjectId    → matches one specific GCP project id
 *
 * A credit's matched-pool is the sum of priced cost entries whose
 * (skuId, skuGroupId, projectId) all satisfy the credit's set filters.
 * The credit's `appliedAmount` is capped by min(remainingAmount, matchedPool,
 * remainingInvoiceAmount). Credits with overlapping pools may each apply
 * their full amount as long as the invoice still has room.
 *
 * If `pricedEntries` is not supplied (legacy callers), the matched pool falls
 * back to remainingInvoiceAmount and filters are effectively ignored.
 */

import { prisma } from '@/lib/db';
import { Prisma, CreditStatus } from '@prisma/client';

/**
 * A priced cost entry passed to the credit engine for filter-matching.
 * Callers compute these during pricing and forward them here so credits can
 * compute their scope-matched pool.
 */
export interface PricedCostEntry {
  skuId: string | null;
  skuGroupId: string | null;
  projectId: string | null;
  cost: Prisma.Decimal;
}

export interface CreditForApplication {
  id: string;
  types: string[];
  totalAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  currency: string;
  validFrom: Date;
  validTo: Date;
  allowCarryOver: boolean;
  status: CreditStatus;
  billingAccountId: string | null;
  matchSkuId: string | null;
  matchSkuGroupId: string | null;
  matchProjectId: string | null;
}

export interface CreditApplicationEntry {
  creditId: string;
  creditTypes: string[];
  appliedAmount: Prisma.Decimal;
  creditRemainingBefore: Prisma.Decimal;
  creditRemainingAfter: Prisma.Decimal;
  matchedPool: Prisma.Decimal | null; // null when no filters were active
}

export interface CreditApplicationResult {
  totalCreditsApplied: Prisma.Decimal;
  creditsUsed: CreditApplicationEntry[];
  finalAmount: Prisma.Decimal;
}

export interface CreditConfigSnapshot {
  creditId: string;
  types: string[];
  remainingAmountBefore: string;
  validFrom: string;
  validTo: string;
  allowCarryOver: boolean;
  matchSkuId: string | null;
  matchSkuGroupId: string | null;
  matchProjectId: string | null;
}

/**
 * Load applicable credits for a customer for a given billing month.
 */
export async function loadApplicableCredits(
  customerId: string,
  billingMonth: string
): Promise<CreditForApplication[]> {
  const [year, month] = billingMonth.split('-').map(Number);
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  const credits = await prisma.credit.findMany({
    where: {
      customerId,
      status: CreditStatus.ACTIVE,
      remainingAmount: { gt: 0 },
      validFrom: { lte: endOfMonth },
      validTo: { gte: startOfMonth },
    },
    orderBy: { validFrom: 'asc' },
  });

  return credits
    .filter((credit) => {
      if (credit.allowCarryOver) return true;
      return credit.validFrom >= startOfMonth && credit.validFrom <= endOfMonth;
    })
    .map((credit) => ({
      id: credit.id,
      types: credit.types,
      totalAmount: credit.totalAmount,
      remainingAmount: credit.remainingAmount,
      currency: credit.currency,
      validFrom: credit.validFrom,
      validTo: credit.validTo,
      allowCarryOver: credit.allowCarryOver,
      status: credit.status,
      billingAccountId: credit.billingAccountId,
      matchSkuId: credit.matchSkuId,
      matchSkuGroupId: credit.matchSkuGroupId,
      matchProjectId: credit.matchProjectId,
    }));
}

/**
 * True iff the entry satisfies every set filter on the credit.
 * Null filters match anything.
 */
function entryMatchesCredit(entry: PricedCostEntry, credit: CreditForApplication): boolean {
  if (credit.matchSkuId != null && entry.skuId !== credit.matchSkuId) return false;
  if (credit.matchSkuGroupId != null && entry.skuGroupId !== credit.matchSkuGroupId) return false;
  if (credit.matchProjectId != null && entry.projectId !== credit.matchProjectId) return false;
  return true;
}

function creditHasFilters(credit: CreditForApplication): boolean {
  return credit.matchSkuId != null || credit.matchSkuGroupId != null || credit.matchProjectId != null;
}

function computeMatchedPool(
  credit: CreditForApplication,
  pricedEntries: PricedCostEntry[] | undefined
): Prisma.Decimal | null {
  if (!creditHasFilters(credit)) return null; // null = unrestricted
  if (!pricedEntries) return null; // legacy caller — fall back to unrestricted
  let sum = new Prisma.Decimal(0);
  for (const entry of pricedEntries) {
    if (entryMatchesCredit(entry, credit)) sum = sum.add(entry.cost);
  }
  return sum;
}

/**
 * Apply credits to an invoice amount, honoring each credit's optional
 * SKU / SKU group / project filters.
 *
 * @param customerId       Customer ID
 * @param invoiceId        Invoice ID (for ledger tracking)
 * @param invoiceRunId     Invoice run ID (for ledger tracking)
 * @param invoiceAmount    Total invoice amount before credits
 * @param billingMonth     YYYY-MM
 * @param pricedEntries    Optional. Priced cost entries with skuId / skuGroupId
 *                         / projectId so filter-bearing credits can compute
 *                         their matched pool. If omitted, filters are ignored
 *                         and behavior matches the pre-3.3.1 engine.
 */
export async function applyCreditsToInvoice(
  customerId: string,
  invoiceId: string,
  invoiceRunId: string,
  invoiceAmount: Prisma.Decimal,
  billingMonth: string,
  pricedEntries?: PricedCostEntry[]
): Promise<CreditApplicationResult> {
  const credits = await loadApplicableCredits(customerId, billingMonth);

  if (credits.length === 0 || invoiceAmount.lte(0)) {
    return {
      totalCreditsApplied: new Prisma.Decimal(0),
      creditsUsed: [],
      finalAmount: invoiceAmount,
    };
  }

  const creditsUsed: CreditApplicationEntry[] = [];
  let remainingInvoiceAmount = invoiceAmount;
  let totalCreditsApplied = new Prisma.Decimal(0);

  for (const credit of credits) {
    if (remainingInvoiceAmount.lte(0)) break;

    const matchedPool = computeMatchedPool(credit, pricedEntries);
    // If credit has filters but no matching cost, skip.
    if (matchedPool != null && matchedPool.lte(0)) continue;

    const creditRemaining = credit.remainingAmount;
    // Cap by: credit's remainingAmount, the matched pool (if any), and the
    // invoice's remaining amount.
    const caps: Prisma.Decimal[] = [creditRemaining, remainingInvoiceAmount];
    if (matchedPool != null) caps.push(matchedPool);
    let amountToApply = caps[0];
    for (let i = 1; i < caps.length; i++) {
      amountToApply = Prisma.Decimal.min(amountToApply, caps[i]);
    }

    if (amountToApply.lte(0)) continue;

    const creditRemainingAfter = creditRemaining.sub(amountToApply);

    await prisma.$transaction(async (tx) => {
      await tx.creditLedger.create({
        data: {
          creditId: credit.id,
          invoiceRunId,
          invoiceId,
          appliedAmount: amountToApply,
          creditRemainingBefore: creditRemaining,
        },
      });
      const newStatus = creditRemainingAfter.lte(0) ? CreditStatus.DEPLETED : credit.status;
      await tx.credit.update({
        where: { id: credit.id },
        data: {
          remainingAmount: creditRemainingAfter,
          status: newStatus,
        },
      });
    });

    creditsUsed.push({
      creditId: credit.id,
      creditTypes: credit.types,
      appliedAmount: amountToApply,
      creditRemainingBefore: creditRemaining,
      creditRemainingAfter,
      matchedPool,
    });

    remainingInvoiceAmount = remainingInvoiceAmount.sub(amountToApply);
    totalCreditsApplied = totalCreditsApplied.add(amountToApply);
  }

  return {
    totalCreditsApplied,
    creditsUsed,
    finalAmount: remainingInvoiceAmount,
  };
}

/**
 * Capture credit config snapshot for reproducibility.
 */
export async function captureCreditConfigSnapshot(
  customerId: string,
  billingMonth: string
): Promise<CreditConfigSnapshot[]> {
  const credits = await loadApplicableCredits(customerId, billingMonth);
  return credits.map((credit) => ({
    creditId: credit.id,
    types: credit.types,
    remainingAmountBefore: credit.remainingAmount.toString(),
    validFrom: credit.validFrom.toISOString().split('T')[0],
    validTo: credit.validTo.toISOString().split('T')[0],
    allowCarryOver: credit.allowCarryOver,
    matchSkuId: credit.matchSkuId,
    matchSkuGroupId: credit.matchSkuGroupId,
    matchProjectId: credit.matchProjectId,
  }));
}

/**
 * Get credit summary for a customer.
 */
export async function getCustomerCreditSummary(customerId: string): Promise<{
  totalActiveCredits: number;
  totalRemainingAmount: Prisma.Decimal;
  creditsByType: Record<string, { count: number; remainingAmount: string }>;
}> {
  const credits = await prisma.credit.findMany({
    where: {
      customerId,
      status: CreditStatus.ACTIVE,
      remainingAmount: { gt: 0 },
    },
  });

  const creditsByType: Record<string, { count: number; remainingAmount: Prisma.Decimal }> = {};
  let totalRemainingAmount = new Prisma.Decimal(0);

  for (const credit of credits) {
    totalRemainingAmount = totalRemainingAmount.add(credit.remainingAmount);
    // A credit with N types contributes to each of those buckets. Counting
    // remainingAmount on every bucket would double-count totals, so we only
    // count membership here and use totalRemainingAmount for the global total.
    for (const t of credit.types) {
      if (!creditsByType[t]) {
        creditsByType[t] = { count: 0, remainingAmount: new Prisma.Decimal(0) };
      }
      creditsByType[t].count++;
      creditsByType[t].remainingAmount = creditsByType[t].remainingAmount.add(credit.remainingAmount);
    }
  }

  const creditsByTypeOutput: Record<string, { count: number; remainingAmount: string }> = {};
  for (const [type, data] of Object.entries(creditsByType)) {
    creditsByTypeOutput[type] = {
      count: data.count,
      remainingAmount: data.remainingAmount.toString(),
    };
  }

  return {
    totalActiveCredits: credits.length,
    totalRemainingAmount,
    creditsByType: creditsByTypeOutput,
  };
}
