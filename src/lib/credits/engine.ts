/**
 * Credits Engine (Phase 3.3)
 *
 * Handles credit application to invoices during invoice runs.
 *
 * Features:
 * - Load ACTIVE credits for a customer where billingMonth overlaps [validFrom, validTo]
 * - Apply credits in validFrom ASC order (oldest first)
 * - Generate CreditLedger rows with before/after tracking
 * - Update remainingAmount atomically
 * - Support allowCarryOver=false restriction to billing month
 */

import { prisma } from '@/lib/db';
import { Prisma, CreditStatus } from '@prisma/client';

/**
 * Credit data with necessary fields for application
 */
export interface CreditForApplication {
  id: string;
  type: string;
  totalAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  currency: string;
  validFrom: Date;
  validTo: Date;
  allowCarryOver: boolean;
  status: CreditStatus;
  billingAccountId: string | null;
}

/**
 * Credit application result for a single credit
 */
export interface CreditApplicationEntry {
  creditId: string;
  creditType: string;
  appliedAmount: Prisma.Decimal;
  creditRemainingBefore: Prisma.Decimal;
  creditRemainingAfter: Prisma.Decimal;
}

/**
 * Result of applying credits to an invoice
 */
export interface CreditApplicationResult {
  totalCreditsApplied: Prisma.Decimal;
  creditsUsed: CreditApplicationEntry[];
  finalAmount: Prisma.Decimal;
}

/**
 * Credit snapshot for config snapshot storage
 */
export interface CreditConfigSnapshot {
  creditId: string;
  type: string;
  remainingAmountBefore: string;
  validFrom: string;
  validTo: string;
  allowCarryOver: boolean;
}

/**
 * Load applicable credits for a customer for a given billing month.
 *
 * Credits are applicable if:
 * 1. status = ACTIVE
 * 2. billingMonth overlaps [validFrom, validTo]
 * 3. remainingAmount > 0
 * 4. If allowCarryOver=false, credit validFrom must be in the billing month
 *
 * @param customerId Customer ID
 * @param billingMonth YYYY-MM format
 * @returns Credits sorted by validFrom ASC
 */
export async function loadApplicableCredits(
  customerId: string,
  billingMonth: string
): Promise<CreditForApplication[]> {
  // Parse billing month to get date range
  const [year, month] = billingMonth.split('-').map(Number);
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)); // Last day of month

  // Load active credits that overlap with billing month
  const credits = await prisma.credit.findMany({
    where: {
      customerId,
      status: CreditStatus.ACTIVE,
      remainingAmount: { gt: 0 },
      // Credit validity overlaps with billing month:
      // validFrom <= endOfMonth AND validTo >= startOfMonth
      validFrom: { lte: endOfMonth },
      validTo: { gte: startOfMonth },
    },
    orderBy: { validFrom: 'asc' },
  });

  // Filter credits where allowCarryOver=false must have validFrom in billing month
  return credits.filter((credit) => {
    if (credit.allowCarryOver) {
      // Carry-over allowed, credit can be used in any overlapping month
      return true;
    }

    // allowCarryOver=false: credit validFrom must be within billing month
    // This restricts the credit to only be used in its starting month
    return credit.validFrom >= startOfMonth && credit.validFrom <= endOfMonth;
  });
}

/**
 * Apply credits to an invoice amount.
 *
 * Credits are applied in validFrom ASC order (oldest first).
 * Each credit reduces the invoice amount until either:
 * - Invoice amount reaches 0
 * - All applicable credits are exhausted
 *
 * @param customerId Customer ID
 * @param invoiceId Invoice ID (for ledger tracking)
 * @param invoiceRunId Invoice run ID (for ledger tracking)
 * @param invoiceAmount Amount before credits
 * @param billingMonth YYYY-MM format
 * @returns Credit application result
 */
export async function applyCreditsToInvoice(
  customerId: string,
  invoiceId: string,
  invoiceRunId: string,
  invoiceAmount: Prisma.Decimal,
  billingMonth: string
): Promise<CreditApplicationResult> {
  // Load applicable credits
  const credits = await loadApplicableCredits(customerId, billingMonth);

  // If no credits or invoice is already 0, return early
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

  // Apply each credit in order
  for (const credit of credits) {
    if (remainingInvoiceAmount.lte(0)) {
      break; // Invoice fully covered
    }

    // Calculate how much of this credit to apply
    const creditRemaining = credit.remainingAmount;
    const amountToApply = Prisma.Decimal.min(creditRemaining, remainingInvoiceAmount);

    if (amountToApply.lte(0)) {
      continue; // Skip if nothing to apply
    }

    const creditRemainingAfter = creditRemaining.sub(amountToApply);

    // Create ledger entry and update credit atomically
    await prisma.$transaction(async (tx) => {
      // Create ledger entry
      await tx.creditLedger.create({
        data: {
          creditId: credit.id,
          invoiceRunId,
          invoiceId,
          appliedAmount: amountToApply,
          creditRemainingBefore: creditRemaining,
        },
      });

      // Update credit remaining amount
      const newStatus = creditRemainingAfter.lte(0) ? CreditStatus.DEPLETED : credit.status;

      await tx.credit.update({
        where: { id: credit.id },
        data: {
          remainingAmount: creditRemainingAfter,
          status: newStatus,
        },
      });
    });

    // Track application
    creditsUsed.push({
      creditId: credit.id,
      creditType: credit.type,
      appliedAmount: amountToApply,
      creditRemainingBefore: creditRemaining,
      creditRemainingAfter,
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
 *
 * Stores the state of all applicable credits before they are applied,
 * allowing future audit and replay of the billing run.
 *
 * @param customerId Customer ID
 * @param billingMonth YYYY-MM format
 * @returns Array of credit snapshots
 */
export async function captureCreditConfigSnapshot(
  customerId: string,
  billingMonth: string
): Promise<CreditConfigSnapshot[]> {
  const credits = await loadApplicableCredits(customerId, billingMonth);

  return credits.map((credit) => ({
    creditId: credit.id,
    type: credit.type,
    remainingAmountBefore: credit.remainingAmount.toString(),
    validFrom: credit.validFrom.toISOString().split('T')[0],
    validTo: credit.validTo.toISOString().split('T')[0],
    allowCarryOver: credit.allowCarryOver,
  }));
}

/**
 * Get credit summary for a customer.
 *
 * Returns aggregated information about available credits.
 *
 * @param customerId Customer ID
 * @returns Credit summary
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

    if (!creditsByType[credit.type]) {
      creditsByType[credit.type] = { count: 0, remainingAmount: new Prisma.Decimal(0) };
    }
    creditsByType[credit.type].count++;
    creditsByType[credit.type].remainingAmount = creditsByType[credit.type].remainingAmount.add(
      credit.remainingAmount
    );
  }

  // Convert to string format for output
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
