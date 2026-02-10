/**
 * Billing Engine v3.0 (Phase 3.5 - Special Rules Engine)
 *
 * Generates invoices based on raw cost data, customer-project mappings,
 * and customer-specific pricing rules. Full billing pipeline:
 * 1. Load raw cost entries
 * 2. Apply special rules (EXCLUDE, OVERRIDE_COST, MOVE_TO_CUSTOMER)
 * 3. Apply pricing rules (LIST_DISCOUNT)
 * 4. Apply credits
 *
 * Features:
 * - Phase 2.6: Replayable, metadata, audit, concurrency-safe invoice numbers
 * - Phase 3: Pricing engine with LIST_DISCOUNT rule type
 * - Phase 3.3: Credit application with ledger tracking
 * - Phase 3.5: Special rules engine (exclude, override, move costs)
 * - SKU Group mapping for pricing rule selection
 * - Config snapshot for reproducibility (includes special rules, pricing, credits)
 */

import { prisma } from '@/lib/db';
import { InvoiceRunStatus, InvoiceStatus, Prisma, PrismaClient } from '@prisma/client';
import {
  applyPricingForCustomer,
  capturePricingConfigSnapshot,
  loadSkuGroupMappings,
  type SkuGroupPricingSummary,
  type PricingConfigSnapshot,
} from '@/lib/pricing';
import {
  applyCreditsToInvoice,
  captureCreditConfigSnapshot,
  type CreditConfigSnapshot,
  type CreditApplicationEntry,
} from '@/lib/credits';
import {
  loadApplicableSpecialRules,
  applySpecialRules,
  recordSpecialRuleEffects,
  captureSpecialRulesConfigSnapshot,
  attachSkuGroupsToEntries,
  type CostEntryForRules,
  type SpecialRulesApplicationResult,
  type SpecialRuleConfigSnapshot,
} from '@/lib/special-rules';

export interface BillingEngineOptions {
  ingestionBatchId?: string;  // If provided, only use this batch
  targetCustomerId?: string;  // If provided, only process this customer
}

export interface BillingEngineResult {
  success: boolean;
  invoiceRunId: string;
  invoicesGenerated: number;
  totalAmount: Prisma.Decimal;
  rawTotalAmount: Prisma.Decimal; // Phase 3: Total before pricing
  errors: string[];
  metadata: {
    customerCount: number;
    projectCount: number;
    rowCount: number;
    currencyBreakdown: Record<string, string>;
    ingestionBatchIds: string[];
    costDataTimeRange: {
      from: Date | null;
      to: Date | null;
    };
    // Phase 3: Pricing metadata
    pricingApplied: boolean;
    totalDiscount: string; // rawTotal - pricedTotal
    // Phase 3.3: Credits metadata
    creditsApplied: boolean;
    totalCreditsApplied: string;
    // Phase 3.5: Special rules metadata
    specialRulesApplied: boolean;
    totalSpecialRulesDelta: string;
    specialRulesCount: number;
  };
}

/**
 * Generate customer slug for invoice number
 * Takes first 4 chars of customer name/externalId, uppercase, alphanumeric only
 */
function generateCustomerSlug(customer: { name: string; externalId: string | null }): string {
  const source = customer.externalId || customer.name;
  return source
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4)
    .padEnd(4, 'X');
}

/**
 * Generate concurrency-safe invoice number within a transaction
 * Format: SIEGER-{YYYYMM}-{SLUG}-{0001}
 *
 * Uses count of existing invoices + 1 as sequence number
 * Retries once on unique collision
 */
async function generateInvoiceNumberSafe(
  tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
  customerId: string,
  billingMonth: string,
  customerSlug: string,
  retryCount = 0
): Promise<string> {
  const MAX_RETRIES = 1;

  // Count existing invoices for this customer + billing month
  const existingCount = await tx.invoice.count({
    where: {
      customerId,
      billingMonth,
    },
  });

  const seq = existingCount + 1 + retryCount;
  const seq4 = seq.toString().padStart(4, '0');
  const monthFormatted = billingMonth.replace('-', '');
  const invoiceNumber = `SIEGER-${monthFormatted}-${customerSlug}-${seq4}`;

  // Check if this number already exists (race condition protection)
  const existing = await tx.invoice.findUnique({
    where: { invoiceNumber },
  });

  if (existing) {
    if (retryCount < MAX_RETRIES) {
      // Retry with incremented sequence
      return generateInvoiceNumberSafe(tx, customerId, billingMonth, customerSlug, retryCount + 1);
    }
    // Fallback: append timestamp to guarantee uniqueness
    const timestamp = Date.now().toString(36).toUpperCase().slice(-4);
    return `SIEGER-${monthFormatted}-${customerSlug}-${timestamp}`;
  }

  return invoiceNumber;
}

/**
 * Check if a customer-project binding overlaps with the billing month
 */
function bindingOverlapsBillingMonth(
  binding: { startDate: Date | null; endDate: Date | null },
  startOfMonth: Date,
  endOfMonth: Date
): boolean {
  // If no start date, assume it started before the billing period
  const bindingStart = binding.startDate ?? new Date(0);
  // If no end date, assume it's still active
  const bindingEnd = binding.endDate ?? new Date('2100-01-01');

  // Check overlap: binding starts before month ends AND binding ends after month starts
  return bindingStart < endOfMonth && bindingEnd >= startOfMonth;
}

/**
 * Calculate due date based on payment terms
 */
function calculateDueDate(paymentTermsDays: number): Date {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + paymentTermsDays);
  return dueDate;
}

/**
 * Compute source key for idempotency
 * Format: batch:{batchId} or time:{startISO}:{endISO}
 */
export function computeSourceKey(
  billingMonth: string,
  options: BillingEngineOptions
): string {
  if (options.ingestionBatchId) {
    return `batch:${options.ingestionBatchId}`;
  }

  // Parse billing month to get date range
  const [year, month] = billingMonth.split('-').map(Number);
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 1));

  return `time:${startOfMonth.toISOString()}:${endOfMonth.toISOString()}`;
}

/**
 * Execute an invoice run - generate invoices for all customers
 * Phase 3: Now applies pricing rules from customer's active pricing list
 */
export async function executeInvoiceRun(
  invoiceRunId: string,
  billingMonth: string,
  options: BillingEngineOptions = {}
): Promise<BillingEngineResult> {
  const errors: string[] = [];
  const ingestionBatchIds = new Set<string>();
  const allCurrencyTotals: Record<string, Prisma.Decimal> = {};
  let minTime: Date | null = null;
  let maxTime: Date | null = null;
  let invoicesGenerated = 0;
  let totalAmount = new Prisma.Decimal(0);
  let rawTotalAmount = new Prisma.Decimal(0);
  let customerCount = 0;
  let projectCount = 0;
  let totalRowCount = 0;
  let pricingApplied = false;
  let creditsApplied = false;
  let totalCreditsApplied = new Prisma.Decimal(0);
  let specialRulesApplied = false;
  let totalSpecialRulesDelta = new Prisma.Decimal(0);
  let specialRulesCount = 0;

  try {
    // Parse billing month to get date range [start, end)
    const [year, month] = billingMonth.split('-').map(Number);
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
    const endOfMonth = new Date(Date.UTC(year, month, 1));

    // Compute source key
    const sourceKey = computeSourceKey(billingMonth, options);

    // Update run to RUNNING with source tracking
    await prisma.invoiceRun.update({
      where: { id: invoiceRunId },
      data: {
        status: InvoiceRunStatus.RUNNING,
        startedAt: new Date(),
        sourceKey,
        // Always set time range for reproducibility
        sourceTimeRangeStart: startOfMonth,
        sourceTimeRangeEnd: endOfMonth,
      },
    });

    // Phase 3: Pre-load SKU group mappings for pricing
    const skuGroupMappings = await loadSkuGroupMappings();

    // Build source filter based on options
    const sourceFilter: Prisma.RawCostEntryWhereInput = {};

    if (options.ingestionBatchId) {
      // Use specific batch
      sourceFilter.ingestionBatchId = options.ingestionBatchId;
      ingestionBatchIds.add(options.ingestionBatchId);
    } else {
      // Use time range filter
      sourceFilter.usageStartTime = {
        gte: startOfMonth,
        lt: endOfMonth,
      };
    }

    // Build customer filter
    const customerFilter: Prisma.CustomerWhereInput = {
      status: 'ACTIVE',
      customerProjects: {
        some: {
          isActive: true,
        },
      },
    };

    if (options.targetCustomerId) {
      customerFilter.id = options.targetCustomerId;
    }

    // Get all customers with active project bindings
    const customers = await prisma.customer.findMany({
      where: customerFilter,
      include: {
        customerProjects: {
          where: { isActive: true },
          include: {
            project: true,
          },
        },
      },
    });

    // Track unique projects
    const allProjectIds = new Set<string>();

    // Process each customer
    for (const customer of customers) {
      try {
        // Filter bindings that overlap with billing month
        const activeBindings = customer.customerProjects.filter((cp) =>
          bindingOverlapsBillingMonth(cp, startOfMonth, endOfMonth)
        );

        if (activeBindings.length === 0) {
          continue;
        }

        const projectIds = activeBindings.map((cp) => cp.project.projectId);
        projectIds.forEach((p) => allProjectIds.add(p));

        // Get all raw cost entries for this customer's projects within source filter
        const costEntries = await prisma.rawCostEntry.findMany({
          where: {
            ...sourceFilter,
            projectId: { in: projectIds },
          },
          include: {
            ingestionBatch: true,
          },
        });

        if (costEntries.length === 0) {
          // No cost data for this customer
          continue;
        }

        customerCount++;
        totalRowCount += costEntries.length;

        // Track ingestion batches and time range
        for (const entry of costEntries) {
          ingestionBatchIds.add(entry.ingestionBatchId);
          if (!minTime || entry.usageStartTime < minTime) {
            minTime = entry.usageStartTime;
          }
          if (!maxTime || entry.usageEndTime > maxTime) {
            maxTime = entry.usageEndTime;
          }
        }

        // Calculate raw total (before any transformations)
        let customerRawTotal = new Prisma.Decimal(0);
        for (const entry of costEntries) {
          customerRawTotal = customerRawTotal.add(entry.cost);
        }
        rawTotalAmount = rawTotalAmount.add(customerRawTotal);

        // =====================================================================
        // Phase 3.5: Apply Special Rules BEFORE pricing
        // =====================================================================

        // Convert cost entries to format for special rules engine
        const entriesForRules: CostEntryForRules[] = costEntries.map((e) => ({
          id: e.id,
          billingAccountId: e.billingAccountId,
          projectId: e.projectId,
          serviceId: e.serviceId,
          skuId: e.skuId,
          cost: e.cost,
          currency: e.currency,
          usageStartTime: e.usageStartTime,
          usageEndTime: e.usageEndTime,
        }));

        // Attach SKU group IDs using the already-loaded mappings
        const entriesWithGroups = attachSkuGroupsToEntries(entriesForRules, skuGroupMappings);

        // Load and apply special rules
        const specialRules = await loadApplicableSpecialRules(customer.id, billingMonth);
        const specialRulesResult = applySpecialRules(entriesWithGroups, specialRules);

        // Track special rules effects
        if (specialRulesResult.ruleResults.length > 0) {
          specialRulesApplied = true;
          totalSpecialRulesDelta = totalSpecialRulesDelta.add(specialRulesResult.totalCostDelta);
          specialRulesCount += specialRulesResult.ruleResults.length;

          // Record effects in ledger
          await recordSpecialRuleEffects(invoiceRunId, specialRulesResult.ruleResults);
        }

        // Use transformed entries for pricing (excluded entries are already removed)
        const entriesAfterSpecialRules = specialRulesResult.transformedEntries;

        // TODO: Handle movedEntries - these should be processed when their target customer runs
        // For now, we just log them
        if (specialRulesResult.movedEntries.size > 0) {
          console.log(`Special rules moved ${specialRulesResult.movedEntries.size} entry sets to other customers`);
        }

        // =====================================================================
        // Phase 3: Apply Pricing Rules
        // =====================================================================

        // Apply pricing to entries that survived special rules
        const pricingResult = await applyPricingForCustomer(
          customer.id,
          entriesAfterSpecialRules.map((e) => ({ skuId: e.skuId, cost: e.cost })),
          billingMonth
        );

        if (pricingResult.pricingListId) {
          pricingApplied = true;
        }

        // Use priced total for invoice
        const customerPricedTotal = pricingResult.pricedTotal;

        // Use customer's preferred currency for primary amount
        const primaryCurrency = customer.currency;

        // Aggregate by currency (use entries after special rules for currency breakdown)
        const currencyTotals: Record<string, Prisma.Decimal> = {};
        for (const entry of entriesAfterSpecialRules) {
          if (!currencyTotals[entry.currency]) {
            currencyTotals[entry.currency] = new Prisma.Decimal(0);
          }
          currencyTotals[entry.currency] = currencyTotals[entry.currency].add(entry.cost);

          // Track global currency totals
          if (!allCurrencyTotals[entry.currency]) {
            allCurrencyTotals[entry.currency] = new Prisma.Decimal(0);
          }
          allCurrencyTotals[entry.currency] = allCurrencyTotals[entry.currency].add(entry.cost);
        }

        // Phase 3: Build line items grouped by SKU group with pricing applied
        const lineItemsMap: Record<string, {
          skuGroupCode: string;
          description: string;
          rawAmount: Prisma.Decimal;
          pricedAmount: Prisma.Decimal;
          entryCount: number;
          ruleId: string | null;
          discountRate: string | null;
        }> = {};

        // Use SKU group summary from pricing result
        for (const [skuGroupCode, summary] of Object.entries(pricingResult.skuGroupSummary)) {
          lineItemsMap[skuGroupCode] = {
            skuGroupCode,
            description: skuGroupCode === 'UNMAPPED'
              ? 'Unmapped SKUs (no pricing rule)'
              : `${skuGroupCode} services`,
            rawAmount: new Prisma.Decimal(summary.rawTotal),
            pricedAmount: new Prisma.Decimal(summary.pricedTotal),
            entryCount: summary.entryCount,
            ruleId: summary.ruleId,
            discountRate: summary.discountRate,
          };
        }

        // Build currency breakdown
        const currencyBreakdown = Object.entries(currencyTotals).map(([currency, total]) => ({
          currency,
          rawAmount: total.toString(),
        }));

        // Phase 3: Build pricing summary for invoice metadata
        const pricingSummary = {
          pricingListId: pricingResult.pricingListId,
          rawTotal: customerRawTotal.toString(),
          pricedTotal: customerPricedTotal.toString(),
          discount: customerRawTotal.sub(customerPricedTotal).toString(),
          skuGroupBreakdown: pricingResult.skuGroupSummary,
          rulesUsed: pricingResult.rulesUsed,
        };

        const customerSlug = generateCustomerSlug(customer);

        // Phase 3.5: Capture special rules config snapshot
        const specialRulesSnapshot = await captureSpecialRulesConfigSnapshot(customer.id, billingMonth);

        // Phase 3: Capture config snapshot for reproducibility
        const pricingSnapshot = await capturePricingConfigSnapshot(customer.id);

        // Phase 3.3: Capture credit config snapshot
        const creditSnapshot = await captureCreditConfigSnapshot(customer.id, billingMonth);

        // Create or update config snapshot (includes special rules, pricing, and credits)
        const configSnapshot = await prisma.configSnapshot.create({
          data: {
            customerId: customer.id,
            config: {
              specialRules: specialRulesSnapshot, // Phase 3.5: Include special rules snapshot
              specialRulesApplied: specialRulesResult.rulesApplied, // Rules that actually matched
              pricing: pricingSnapshot,
              credits: creditSnapshot, // Phase 3.3: Include credit snapshot
              billingMonth,
              capturedAt: new Date().toISOString(),
            } as unknown as Prisma.InputJsonValue,
            version: 1,
          },
        });

        // Create invoice within a transaction for concurrency-safe invoice number
        const invoice = await prisma.$transaction(async (tx) => {
          const invoiceNumber = await generateInvoiceNumberSafe(
            tx,
            customer.id,
            billingMonth,
            customerSlug
          );

          return tx.invoice.create({
            data: {
              invoiceRunId,
              customerId: customer.id,
              billingMonth,
              invoiceNumber,
              status: InvoiceStatus.DRAFT,
              subtotal: customerPricedTotal, // Phase 3: Use priced total
              taxAmount: new Prisma.Decimal(0),
              totalAmount: customerPricedTotal, // Phase 3: Use priced total (before credits)
              creditAmount: new Prisma.Decimal(0), // Phase 3.3: Will be updated after credit application
              currency: Object.keys(currencyTotals).length === 1 ? primaryCurrency : 'MIXED',
              currencyBreakdown: {
                currencies: currencyBreakdown,
                pricing: pricingSummary, // Phase 3: Include pricing breakdown
              } as unknown as Prisma.InputJsonValue,
              issueDate: new Date(),
              dueDate: calculateDueDate(customer.paymentTermsDays),
              lineItems: {
                create: Object.values(lineItemsMap).map((item, index) => ({
                  lineNumber: index + 1,
                  description: item.description,
                  quantity: new Prisma.Decimal(item.entryCount),
                  unitPrice: item.entryCount > 0
                    ? item.pricedAmount.div(item.entryCount)
                    : new Prisma.Decimal(0),
                  amount: item.pricedAmount,
                  metadata: {
                    skuGroupCode: item.skuGroupCode,
                    rawAmount: item.rawAmount.toString(),
                    pricedAmount: item.pricedAmount.toString(),
                    entryCount: item.entryCount,
                    ruleId: item.ruleId,
                    discountRate: item.discountRate,
                  } as Prisma.InputJsonValue,
                })),
              },
            },
          });
        });

        // Phase 3.3: Apply credits to invoice
        const creditResult = await applyCreditsToInvoice(
          customer.id,
          invoice.id,
          invoiceRunId,
          customerPricedTotal,
          billingMonth
        );

        // Update invoice with credit amounts if credits were applied
        let finalInvoiceAmount = customerPricedTotal;
        if (creditResult.totalCreditsApplied.gt(0)) {
          creditsApplied = true;
          totalCreditsApplied = totalCreditsApplied.add(creditResult.totalCreditsApplied);
          finalInvoiceAmount = creditResult.finalAmount;

          // Update invoice with credit information
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              creditAmount: creditResult.totalCreditsApplied,
              totalAmount: creditResult.finalAmount,
              currencyBreakdown: {
                currencies: currencyBreakdown,
                pricing: pricingSummary,
                credits: {
                  totalCreditsApplied: creditResult.totalCreditsApplied.toString(),
                  creditsUsed: creditResult.creditsUsed.map((c) => ({
                    creditId: c.creditId,
                    creditType: c.creditType,
                    appliedAmount: c.appliedAmount.toString(),
                  })),
                },
              } as unknown as Prisma.InputJsonValue,
            },
          });
        }

        // Update invoice run with config snapshot
        await prisma.invoiceRun.update({
          where: { id: invoiceRunId },
          data: {
            configSnapshotId: configSnapshot.id,
          },
        });

        invoicesGenerated++;
        totalAmount = totalAmount.add(finalInvoiceAmount);

        const discountAmount = customerRawTotal.sub(customerPricedTotal);
        const creditInfo = creditResult.totalCreditsApplied.gt(0)
          ? `, credits: ${creditResult.totalCreditsApplied.toString()}, final: ${finalInvoiceAmount.toString()}`
          : '';
        const discountInfo = pricingResult.pricingListId
          ? ` (raw: ${customerRawTotal.toString()}, discount: ${discountAmount.toString()}${creditInfo})`
          : ` (no pricing rules${creditInfo})`;

        console.log(`Generated invoice ${invoice.invoiceNumber} for ${customer.name}: ${finalInvoiceAmount.toString()} ${invoice.currency}${discountInfo}`);

      } catch (customerError) {
        const errorMessage = `Failed to process customer ${customer.name}: ${customerError}`;
        errors.push(errorMessage);
        console.error(errorMessage);
      }
    }

    projectCount = allProjectIds.size;

    // Build currency breakdown for run metadata
    const runCurrencyBreakdown: Record<string, string> = {};
    for (const [currency, total] of Object.entries(allCurrencyTotals)) {
      runCurrencyBreakdown[currency] = total.toString();
    }

    // Update invoice run with results
    const finalStatus = errors.length > 0 && invoicesGenerated === 0
      ? InvoiceRunStatus.FAILED
      : InvoiceRunStatus.SUCCEEDED;

    await prisma.invoiceRun.update({
      where: { id: invoiceRunId },
      data: {
        status: finalStatus,
        finishedAt: new Date(),
        totalInvoices: invoicesGenerated,
        totalAmount,
        errorMessage: errors.length > 0 ? errors.join('; ') : null,
        errorDetails: errors.length > 0 ? { errors } as Prisma.InputJsonValue : Prisma.JsonNull,
        sourceIngestionBatchIds: Array.from(ingestionBatchIds),
        sourceTimeRangeStart: minTime ?? startOfMonth,
        sourceTimeRangeEnd: maxTime ?? endOfMonth,
        // Phase 2.6 metadata
        customerCount,
        projectCount,
        rowCount: totalRowCount,
        currencyBreakdown: runCurrencyBreakdown as Prisma.InputJsonValue,
      },
    });

    // totalDiscount is rawTotal - pricedTotal (before credits)
    // totalAmount already accounts for credits applied
    const totalDiscount = rawTotalAmount.sub(totalAmount).sub(totalCreditsApplied);

    return {
      success: errors.length === 0,
      invoiceRunId,
      invoicesGenerated,
      totalAmount,
      rawTotalAmount,
      errors,
      metadata: {
        customerCount,
        projectCount,
        rowCount: totalRowCount,
        currencyBreakdown: runCurrencyBreakdown,
        ingestionBatchIds: Array.from(ingestionBatchIds),
        costDataTimeRange: {
          from: minTime,
          to: maxTime,
        },
        pricingApplied,
        totalDiscount: totalDiscount.toString(),
        // Phase 3.3: Credits metadata
        creditsApplied,
        totalCreditsApplied: totalCreditsApplied.toString(),
        // Phase 3.5: Special rules metadata
        specialRulesApplied,
        totalSpecialRulesDelta: totalSpecialRulesDelta.toString(),
        specialRulesCount,
      },
    };

  } catch (error) {
    // Mark run as failed with error details
    await prisma.invoiceRun.update({
      where: { id: invoiceRunId },
      data: {
        status: InvoiceRunStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: String(error),
        errorDetails: {
          error: String(error),
          stack: error instanceof Error ? error.stack : undefined,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      success: false,
      invoiceRunId,
      invoicesGenerated,
      totalAmount,
      rawTotalAmount,
      errors: [String(error)],
      metadata: {
        customerCount,
        projectCount,
        rowCount: totalRowCount,
        currencyBreakdown: {},
        ingestionBatchIds: Array.from(ingestionBatchIds),
        costDataTimeRange: {
          from: minTime,
          to: maxTime,
        },
        pricingApplied: false,
        totalDiscount: '0',
        // Phase 3.3: Credits metadata
        creditsApplied: false,
        totalCreditsApplied: '0',
        // Phase 3.5: Special rules metadata
        specialRulesApplied: false,
        totalSpecialRulesDelta: '0',
        specialRulesCount: 0,
      },
    };
  }
}
