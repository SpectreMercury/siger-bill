/**
 * Unified Billing Engine v4.0 (Phase 5 - Multi-Cloud Foundation)
 *
 * Extends the billing engine to support multiple providers using the
 * BillingLineItem abstraction. This engine can process data from:
 * - GCP BigQuery billing exports
 * - AWS Cost & Usage Reports (CUR)
 * - OpenAI Usage API
 * - Azure Cost Management (planned)
 * - Custom sources
 *
 * The unified engine:
 * 1. Fetches data via provider adapters -> BillingLineItem[]
 * 2. Stores line items in BillingLineItem table
 * 3. Converts to internal format for special rules/pricing
 * 4. Runs the full billing pipeline
 *
 * Backward compatible: Can still process RawCostEntry (GCP-specific)
 */

import { prisma } from '@/lib/db';
import {
  BillingProvider,
  BillingSourceType,
  InvoiceRunStatus,
  InvoiceStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import {
  applyPricingForCustomer,
  capturePricingConfigSnapshot,
  loadSkuGroupMappings,
} from '@/lib/pricing';
import {
  applyCreditsToInvoice,
  captureCreditConfigSnapshot,
} from '@/lib/credits';
import {
  loadApplicableSpecialRules,
  applySpecialRules,
  recordSpecialRuleEffects,
  captureSpecialRulesConfigSnapshot,
  attachSkuGroupsToEntries,
  type CostEntryForRules,
} from '@/lib/special-rules';
import {
  type BillingSourceAdapter,
  type BillingLineItemDTO,
  type FetchLineItemsResult,
  createLineItemsChecksum,
} from './adapters';

/**
 * Options for the unified billing engine
 */
export interface UnifiedBillingOptions {
  /** Provider to process (null = all providers with data) */
  provider?: BillingProvider;

  /** Source type filter */
  sourceType?: BillingSourceType;

  /** Specific ingestion batch ID */
  ingestionBatchId?: string;

  /** Target single customer */
  targetCustomerId?: string;

  /** User ID for audit trail */
  userId: string;

  /** Skip fetching new data, only process existing BillingLineItems */
  skipFetch?: boolean;

  /** Custom adapters (if not using environment config) */
  adapters?: BillingSourceAdapter[];
}

/**
 * Result of unified billing run
 */
export interface UnifiedBillingResult {
  success: boolean;
  invoiceRunId: string;
  invoicesGenerated: number;
  totalAmount: Prisma.Decimal;
  rawTotalAmount: Prisma.Decimal;
  errors: string[];
  metadata: {
    provider: BillingProvider | null;
    sourceType: BillingSourceType | null;
    customerCount: number;
    projectCount: number;
    rowCount: number;
    currencyBreakdown: Record<string, string>;
    ingestionBatchIds: string[];
    costDataTimeRange: {
      from: Date | null;
      to: Date | null;
    };
    pricingApplied: boolean;
    totalDiscount: string;
    creditsApplied: boolean;
    totalCreditsApplied: string;
    specialRulesApplied: boolean;
    totalSpecialRulesDelta: string;
    specialRulesCount: number;
  };
}

/**
 * Convert BillingLineItem to CostEntryForRules format
 */
function lineItemToCostEntry(item: {
  id: string;
  accountId: string;
  subaccountId: string | null;
  resourceId: string | null;
  productId: string;
  meterId: string;
  cost: Prisma.Decimal;
  currency: string;
  usageStartTime: Date;
  usageEndTime: Date;
}): CostEntryForRules {
  return {
    id: item.id,
    billingAccountId: item.accountId,
    projectId: item.subaccountId || item.accountId, // Use subaccount as project equivalent
    serviceId: item.productId,
    skuId: item.meterId,
    cost: item.cost,
    currency: item.currency,
    usageStartTime: item.usageStartTime,
    usageEndTime: item.usageEndTime,
  };
}

/**
 * Generate customer slug for invoice number
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
 * Generate concurrency-safe invoice number
 */
async function generateInvoiceNumberSafe(
  tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
  customerId: string,
  billingMonth: string,
  customerSlug: string,
  retryCount = 0
): Promise<string> {
  const MAX_RETRIES = 1;

  const existingCount = await tx.invoice.count({
    where: { customerId, billingMonth },
  });

  const seq = existingCount + 1 + retryCount;
  const seq4 = seq.toString().padStart(4, '0');
  const monthFormatted = billingMonth.replace('-', '');
  const invoiceNumber = `SIEGER-${monthFormatted}-${customerSlug}-${seq4}`;

  const existing = await tx.invoice.findUnique({
    where: { invoiceNumber },
  });

  if (existing) {
    if (retryCount < MAX_RETRIES) {
      return generateInvoiceNumberSafe(tx, customerId, billingMonth, customerSlug, retryCount + 1);
    }
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
  const bindingStart = binding.startDate ?? new Date(0);
  const bindingEnd = binding.endDate ?? new Date('2100-01-01');
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
 * Ingest billing data from an adapter and store in BillingLineItem table
 */
export async function ingestFromAdapter(
  adapter: BillingSourceAdapter,
  month: string,
  userId: string,
  accountIds?: string[]
): Promise<{ batchId: string; rowCount: number }> {
  // Fetch data from adapter
  const result = await adapter.fetchLineItems({
    provider: adapter.provider,
    month,
    accountIds,
  });

  if (result.lineItems.length === 0) {
    throw new Error(`No billing data fetched from ${adapter.provider} for ${month}`);
  }

  // Check for duplicate batch (same provider + checksum + month + sourceType)
  const existingBatch = await prisma.billingIngestionBatch.findFirst({
    where: {
      provider: adapter.provider,
      sourceType: adapter.sourceType,
      invoiceMonth: month,
      checksum: result.checksum,
    },
  });

  if (existingBatch) {
    console.log(`Batch already exists for ${adapter.provider} ${month} with same checksum`);
    return { batchId: existingBatch.id, rowCount: existingBatch.rowCount };
  }

  // Create ingestion batch and line items in transaction
  const batch = await prisma.$transaction(async (tx) => {
    const newBatch = await tx.billingIngestionBatch.create({
      data: {
        provider: adapter.provider,
        sourceType: adapter.sourceType,
        invoiceMonth: month,
        rowCount: result.lineItems.length,
        checksum: result.checksum,
        sourceMetadata: result.sourceMetadata as Prisma.InputJsonValue,
        createdBy: userId,
      },
    });

    // Bulk insert line items
    await tx.billingLineItem.createMany({
      data: result.lineItems.map((item) => ({
        ingestionBatchId: newBatch.id,
        provider: item.provider,
        sourceType: item.sourceType,
        accountId: item.accountId,
        subaccountId: item.subaccountId,
        resourceId: item.resourceId,
        productId: item.productId,
        meterId: item.meterId,
        usageAmount: item.usageAmount,
        usageUnit: item.usageUnit,
        cost: item.cost,
        listCost: item.listCost,
        currency: item.currency,
        usageStartTime: item.usageStartTime,
        usageEndTime: item.usageEndTime,
        invoiceMonth: item.invoiceMonth,
        region: item.region,
        tags: item.tags as Prisma.InputJsonValue,
        rawPayload: item.rawPayload as Prisma.InputJsonValue,
      })),
    });

    return newBatch;
  });

  console.log(`Ingested ${result.lineItems.length} line items from ${adapter.provider} for ${month}`);
  return { batchId: batch.id, rowCount: batch.rowCount };
}

/**
 * Execute a unified invoice run using BillingLineItem data
 */
export async function executeUnifiedInvoiceRun(
  invoiceRunId: string,
  billingMonth: string,
  options: UnifiedBillingOptions
): Promise<UnifiedBillingResult> {
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
    const [year, month] = billingMonth.split('-').map(Number);
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
    const endOfMonth = new Date(Date.UTC(year, month, 1));

    // Update run to RUNNING with provider info
    await prisma.invoiceRun.update({
      where: { id: invoiceRunId },
      data: {
        status: InvoiceRunStatus.RUNNING,
        startedAt: new Date(),
        provider: options.provider,
        sourceType: options.sourceType,
        sourceTimeRangeStart: startOfMonth,
        sourceTimeRangeEnd: endOfMonth,
      },
    });

    // Pre-load SKU group mappings
    const skuGroupMappings = await loadSkuGroupMappings();

    // Build line item filter
    const lineItemFilter: Prisma.BillingLineItemWhereInput = {
      invoiceMonth: billingMonth,
    };

    if (options.provider) {
      lineItemFilter.provider = options.provider;
    }
    if (options.sourceType) {
      lineItemFilter.sourceType = options.sourceType;
    }
    if (options.ingestionBatchId) {
      lineItemFilter.ingestionBatchId = options.ingestionBatchId;
      ingestionBatchIds.add(options.ingestionBatchId);
    }

    // Build customer filter
    const customerFilter: Prisma.CustomerWhereInput = {
      status: 'ACTIVE',
      customerProjects: {
        some: { isActive: true },
      },
    };

    if (options.targetCustomerId) {
      customerFilter.id = options.targetCustomerId;
    }

    // Get customers with their project bindings
    const customers = await prisma.customer.findMany({
      where: customerFilter,
      include: {
        customerProjects: {
          where: { isActive: true },
          include: { project: true },
        },
      },
    });

    const allSubaccountIds = new Set<string>();

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

        // Get project IDs (these map to subaccountId in BillingLineItem)
        const projectIds = activeBindings.map((cp) => cp.project.projectId);
        projectIds.forEach((p) => allSubaccountIds.add(p));

        // Query BillingLineItem for this customer's projects
        const lineItems = await prisma.billingLineItem.findMany({
          where: {
            ...lineItemFilter,
            subaccountId: { in: projectIds },
          },
        });

        if (lineItems.length === 0) {
          continue;
        }

        customerCount++;
        totalRowCount += lineItems.length;

        // Track ingestion batches and time range
        for (const item of lineItems) {
          ingestionBatchIds.add(item.ingestionBatchId);
          if (!minTime || item.usageStartTime < minTime) {
            minTime = item.usageStartTime;
          }
          if (!maxTime || item.usageEndTime > maxTime) {
            maxTime = item.usageEndTime;
          }
        }

        // Calculate raw total
        let customerRawTotal = new Prisma.Decimal(0);
        for (const item of lineItems) {
          customerRawTotal = customerRawTotal.add(item.cost);
        }
        rawTotalAmount = rawTotalAmount.add(customerRawTotal);

        // Convert to CostEntryForRules format
        const entriesForRules: CostEntryForRules[] = lineItems.map((item) =>
          lineItemToCostEntry(item)
        );

        // Attach SKU groups
        const entriesWithGroups = attachSkuGroupsToEntries(entriesForRules, skuGroupMappings);

        // Apply special rules
        const specialRules = await loadApplicableSpecialRules(customer.id, billingMonth);
        const specialRulesResult = applySpecialRules(entriesWithGroups, specialRules);

        if (specialRulesResult.ruleResults.length > 0) {
          specialRulesApplied = true;
          totalSpecialRulesDelta = totalSpecialRulesDelta.add(specialRulesResult.totalCostDelta);
          specialRulesCount += specialRulesResult.ruleResults.length;
          await recordSpecialRuleEffects(invoiceRunId, specialRulesResult.ruleResults);
        }

        const entriesAfterSpecialRules = specialRulesResult.transformedEntries;

        // Apply pricing
        const pricingResult = await applyPricingForCustomer(
          customer.id,
          entriesAfterSpecialRules.map((e) => ({ skuId: e.skuId, cost: e.cost })),
          billingMonth
        );

        if (pricingResult.pricingListId) {
          pricingApplied = true;
        }

        const customerPricedTotal = pricingResult.pricedTotal;
        const primaryCurrency = customer.currency;

        // Aggregate by currency
        const currencyTotals: Record<string, Prisma.Decimal> = {};
        for (const entry of entriesAfterSpecialRules) {
          if (!currencyTotals[entry.currency]) {
            currencyTotals[entry.currency] = new Prisma.Decimal(0);
          }
          currencyTotals[entry.currency] = currencyTotals[entry.currency].add(entry.cost);

          if (!allCurrencyTotals[entry.currency]) {
            allCurrencyTotals[entry.currency] = new Prisma.Decimal(0);
          }
          allCurrencyTotals[entry.currency] = allCurrencyTotals[entry.currency].add(entry.cost);
        }

        // Build line items grouped by SKU group
        const lineItemsMap: Record<string, {
          skuGroupCode: string;
          description: string;
          rawAmount: Prisma.Decimal;
          pricedAmount: Prisma.Decimal;
          entryCount: number;
          ruleId: string | null;
          discountRate: string | null;
        }> = {};

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

        const currencyBreakdown = Object.entries(currencyTotals).map(([currency, total]) => ({
          currency,
          rawAmount: total.toString(),
        }));

        const pricingSummary = {
          pricingListId: pricingResult.pricingListId,
          rawTotal: customerRawTotal.toString(),
          pricedTotal: customerPricedTotal.toString(),
          discount: customerRawTotal.sub(customerPricedTotal).toString(),
          skuGroupBreakdown: pricingResult.skuGroupSummary,
          rulesUsed: pricingResult.rulesUsed,
        };

        const customerSlug = generateCustomerSlug(customer);

        // Capture config snapshots
        const specialRulesSnapshot = await captureSpecialRulesConfigSnapshot(customer.id, billingMonth);
        const pricingSnapshot = await capturePricingConfigSnapshot(customer.id);
        const creditSnapshot = await captureCreditConfigSnapshot(customer.id, billingMonth);

        const configSnapshot = await prisma.configSnapshot.create({
          data: {
            customerId: customer.id,
            config: {
              provider: options.provider,
              sourceType: options.sourceType,
              specialRules: specialRulesSnapshot,
              specialRulesApplied: specialRulesResult.rulesApplied,
              pricing: pricingSnapshot,
              credits: creditSnapshot,
              billingMonth,
              capturedAt: new Date().toISOString(),
            } as unknown as Prisma.InputJsonValue,
            version: 1,
          },
        });

        // Create invoice
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
              subtotal: customerPricedTotal,
              taxAmount: new Prisma.Decimal(0),
              totalAmount: customerPricedTotal,
              creditAmount: new Prisma.Decimal(0),
              currency: Object.keys(currencyTotals).length === 1 ? primaryCurrency : 'MIXED',
              currencyBreakdown: {
                currencies: currencyBreakdown,
                pricing: pricingSummary,
                provider: options.provider,
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

        // Apply credits
        const creditResult = await applyCreditsToInvoice(
          customer.id,
          invoice.id,
          invoiceRunId,
          customerPricedTotal,
          billingMonth
        );

        let finalInvoiceAmount = customerPricedTotal;
        if (creditResult.totalCreditsApplied.gt(0)) {
          creditsApplied = true;
          totalCreditsApplied = totalCreditsApplied.add(creditResult.totalCreditsApplied);
          finalInvoiceAmount = creditResult.finalAmount;

          await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              creditAmount: creditResult.totalCreditsApplied,
              totalAmount: creditResult.finalAmount,
              currencyBreakdown: {
                currencies: currencyBreakdown,
                pricing: pricingSummary,
                provider: options.provider,
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

        await prisma.invoiceRun.update({
          where: { id: invoiceRunId },
          data: { configSnapshotId: configSnapshot.id },
        });

        invoicesGenerated++;
        totalAmount = totalAmount.add(finalInvoiceAmount);

        console.log(
          `Generated invoice ${invoice.invoiceNumber} for ${customer.name}: ` +
            `${finalInvoiceAmount.toString()} ${invoice.currency} (provider: ${options.provider || 'multi'})`
        );
      } catch (customerError) {
        const errorMessage = `Failed to process customer ${customer.name}: ${customerError}`;
        errors.push(errorMessage);
        console.error(errorMessage);
      }
    }

    projectCount = allSubaccountIds.size;

    const runCurrencyBreakdown: Record<string, string> = {};
    for (const [currency, total] of Object.entries(allCurrencyTotals)) {
      runCurrencyBreakdown[currency] = total.toString();
    }

    const finalStatus =
      errors.length > 0 && invoicesGenerated === 0
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
        errorDetails: errors.length > 0 ? ({ errors } as Prisma.InputJsonValue) : Prisma.JsonNull,
        sourceIngestionBatchIds: Array.from(ingestionBatchIds),
        sourceTimeRangeStart: minTime ?? startOfMonth,
        sourceTimeRangeEnd: maxTime ?? endOfMonth,
        customerCount,
        projectCount,
        rowCount: totalRowCount,
        currencyBreakdown: runCurrencyBreakdown as Prisma.InputJsonValue,
        sourceMetadata: {
          provider: options.provider,
          sourceType: options.sourceType,
          unifiedEngine: true,
          version: '4.0',
        } as Prisma.InputJsonValue,
      },
    });

    const totalDiscount = rawTotalAmount.sub(totalAmount).sub(totalCreditsApplied);

    return {
      success: errors.length === 0,
      invoiceRunId,
      invoicesGenerated,
      totalAmount,
      rawTotalAmount,
      errors,
      metadata: {
        provider: options.provider ?? null,
        sourceType: options.sourceType ?? null,
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
        creditsApplied,
        totalCreditsApplied: totalCreditsApplied.toString(),
        specialRulesApplied,
        totalSpecialRulesDelta: totalSpecialRulesDelta.toString(),
        specialRulesCount,
      },
    };
  } catch (error) {
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
        provider: options.provider ?? null,
        sourceType: options.sourceType ?? null,
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
        creditsApplied: false,
        totalCreditsApplied: '0',
        specialRulesApplied: false,
        totalSpecialRulesDelta: '0',
        specialRulesCount: 0,
      },
    };
  }
}

/**
 * Create a unified invoice run
 */
export async function createUnifiedInvoiceRun(
  billingMonth: string,
  options: UnifiedBillingOptions
): Promise<{ invoiceRunId: string }> {
  const run = await prisma.invoiceRun.create({
    data: {
      billingMonth,
      status: InvoiceRunStatus.QUEUED,
      createdBy: options.userId,
      totalAmount: new Prisma.Decimal(0),
      totalInvoices: 0,
      provider: options.provider,
      sourceType: options.sourceType,
      sourceMetadata: {
        unified: true,
        version: '4.0',
        provider: options.provider,
        sourceType: options.sourceType,
      } as Prisma.InputJsonValue,
    },
  });

  return { invoiceRunId: run.id };
}
