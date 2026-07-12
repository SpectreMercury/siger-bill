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

import { prisma, withTransientPrismaRetry } from '@/lib/db';
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
  type PricedCostEntry,
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

const BILLING_LINE_ITEM_INSERT_CHUNK_SIZE = Number(
  process.env.BILLING_LINE_ITEM_INSERT_CHUNK_SIZE || 1_000
);
const BILLING_BULK_INSERT_STATEMENT_TIMEOUT_MS = Number(
  process.env.BILLING_BULK_INSERT_STATEMENT_TIMEOUT_MS || 45_000
);
const BILLING_INCOMPLETE_BATCH_STALE_AFTER_MS = Number(
  process.env.BILLING_INCOMPLETE_BATCH_STALE_AFTER_MS || 30 * 60 * 1_000
);
const BILLING_INGEST_TRANSACTION_MAX_WAIT_MS = Number(
  process.env.BILLING_INGEST_TRANSACTION_MAX_WAIT_MS || 30_000
);
const BILLING_INGEST_TRANSACTION_TIMEOUT_MS = Number(
  process.env.BILLING_INGEST_TRANSACTION_TIMEOUT_MS || 600_000
);

type BillingSourceIdentity = {
  sourceKey: string | null;
  source: string | null;
};

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

function getBillingSourceIdentity(sourceMetadata: Record<string, unknown>): BillingSourceIdentity {
  const sourceKey = typeof sourceMetadata.sourceKey === 'string' ? sourceMetadata.sourceKey : null;
  const source = typeof sourceMetadata.source === 'string' ? sourceMetadata.source : null;
  return { sourceKey, source };
}

function buildSameSourceBatchWhere(params: {
  provider: BillingProvider;
  sourceType: BillingSourceType;
  invoiceMonth: string;
  sourceIdentity: BillingSourceIdentity;
}): Prisma.BillingIngestionBatchWhereInput {
  const base: Prisma.BillingIngestionBatchWhereInput = {
    provider: params.provider,
    sourceType: params.sourceType,
    invoiceMonth: params.invoiceMonth,
  };

  const sourceFilters: Prisma.BillingIngestionBatchWhereInput[] = [];
  if (params.sourceIdentity.sourceKey) {
    sourceFilters.push({
      sourceMetadata: {
        path: ['sourceKey'],
        equals: params.sourceIdentity.sourceKey,
      },
    });
  }
  if (params.sourceIdentity.source) {
    sourceFilters.push({
      sourceMetadata: {
        path: ['source'],
        equals: params.sourceIdentity.source,
      },
    });
  }

  if (sourceFilters.length === 0) return base;
  if (sourceFilters.length === 1) return { ...base, ...sourceFilters[0] };
  return { ...base, OR: sourceFilters };
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

  const accountIdsForNames = Array.from(new Set(result.lineItems.map((item) => item.accountId)));
  const billingAccounts = await prisma.billingAccount.findMany({
    where: { billingAccountId: { in: accountIdsForNames } },
    select: { billingAccountId: true, name: true },
  });
  const billingAccountNameById = new Map(
    billingAccounts.map((account) => [account.billingAccountId, account.name])
  );

  const sourceMetadata = result.sourceMetadata as Record<string, unknown>;
  const sourceIdentity = getBillingSourceIdentity(sourceMetadata);
  const sameSourceWhere = buildSameSourceBatchWhere({
    provider: adapter.provider,
    sourceType: adapter.sourceType,
    invoiceMonth: month,
    sourceIdentity,
  });
  const uniqueBatchWhere = {
    provider: adapter.provider,
    sourceType: adapter.sourceType,
    invoiceMonth: month,
    checksum: result.checksum,
  };

  const reuseBatch = async (batchId: string, logMessage: string) => {
    const activeBatch = await prisma.$transaction(async (tx) => {
      await tx.billingIngestionBatch.updateMany({
        where: {
          ...sameSourceWhere,
          id: { not: batchId },
          isActive: true,
        },
        data: {
          isActive: false,
          supersededAt: new Date(),
        },
      });

      return tx.billingIngestionBatch.update({
        where: { id: batchId },
        data: {
          isActive: true,
          supersededAt: null,
        },
      });
    });

    console.log(logMessage);
    return { batchId: activeBatch.id, rowCount: activeBatch.rowCount };
  };

  const cleanupIncompleteBatch = async (batchId: string, staleBefore?: Date) => {
    return prisma.billingIngestionBatch.deleteMany({
      where: {
        id: batchId,
        isActive: false,
        ...(staleBefore ? { updatedAt: { lte: staleBefore } } : {}),
      },
    });
  };

  const isCompleteBatch = async (batch: { id: string; rowCount: number }) => {
    if (batch.rowCount !== result.lineItems.length) return false;

    const lineItemCount = await prisma.billingLineItem.count({
      where: { ingestionBatchId: batch.id },
    });
    return lineItemCount === batch.rowCount;
  };

  const decimalToString = (value: unknown) => (value === null || value === undefined ? null : String(value));
  const dateToIsoString = (value: Date | string) =>
    value instanceof Date ? value.toISOString() : new Date(value).toISOString();

  const toBulkInsertRows = (items: BillingLineItemDTO[]) =>
    items.map((item) => ({
      account_id: item.accountId,
      billing_account_name: item.billingAccountName ?? billingAccountNameById.get(item.accountId) ?? null,
      subaccount_id: item.subaccountId ?? null,
      project_name: item.projectName ?? null,
      resource_id: item.resourceId ?? null,
      product_id: item.productId,
      service_description: item.serviceDescription ?? null,
      meter_id: item.meterId,
      sku_description: item.skuDescription ?? null,
      usage_amount: decimalToString(item.usageAmount),
      usage_unit: item.usageUnit,
      pricing_usage_amount: decimalToString(item.pricingUsageAmount),
      pricing_usage_unit: item.pricingUsageUnit ?? null,
      cost: decimalToString(item.cost),
      list_cost: decimalToString(item.listCost),
      credit_amount: decimalToString(item.creditAmount),
      cost_after_credit: decimalToString(item.costAfterCredit),
      currency: item.currency,
      currency_conversion_rate: decimalToString(item.currencyConversionRate),
      credit_breakdown: item.creditBreakdown ?? null,
      transaction_type: item.transactionType ?? null,
      usage_start_time: dateToIsoString(item.usageStartTime),
      usage_end_time: dateToIsoString(item.usageEndTime),
      invoice_month: item.invoiceMonth,
      region: item.region,
      tags: item.tags ?? null,
      raw_payload: item.rawPayload ?? null,
    }));

  const bulkInsertLineItemChunk = async (batchId: string, items: BillingLineItemDTO[]) => {
    const rows = JSON.stringify(toBulkInsertRows(items));
    const statementTimeoutMs = Math.max(1_000, BILLING_BULK_INSERT_STATEMENT_TIMEOUT_MS);
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`);
        await tx.$executeRawUnsafe(`SET LOCAL idle_in_transaction_session_timeout = '${statementTimeoutMs}ms'`);
        await tx.$executeRaw`
          INSERT INTO "billing_line_items" (
            "id",
            "ingestion_batch_id",
            "provider",
            "source_type",
            "account_id",
            "billing_account_name",
            "subaccount_id",
            "project_name",
            "resource_id",
            "product_id",
            "service_description",
            "meter_id",
            "sku_description",
            "usage_amount",
            "usage_unit",
            "pricing_usage_amount",
            "pricing_usage_unit",
            "cost",
            "list_cost",
            "credit_amount",
            "cost_after_credit",
            "currency",
            "currency_conversion_rate",
            "credit_breakdown",
            "transaction_type",
            "usage_start_time",
            "usage_end_time",
            "invoice_month",
            "region",
            "tags",
            "raw_payload"
          )
          SELECT
            gen_random_uuid(),
            ${batchId}::uuid,
            ${adapter.provider}::billing_provider,
            ${adapter.sourceType}::billing_source_type,
            row.account_id::varchar(100),
            row.billing_account_name::varchar(255),
            row.subaccount_id::varchar(100),
            row.project_name::varchar(255),
            row.resource_id::varchar(255),
            row.product_id::varchar(100),
            row.service_description::varchar(255),
            row.meter_id::varchar(100),
            row.sku_description::varchar(500),
            row.usage_amount::numeric,
            row.usage_unit::varchar(50),
            row.pricing_usage_amount::numeric,
            row.pricing_usage_unit::varchar(50),
            row.cost::numeric,
            row.list_cost::numeric,
            row.credit_amount::numeric,
            row.cost_after_credit::numeric,
            row.currency::varchar(3),
            row.currency_conversion_rate::numeric,
            row.credit_breakdown,
            row.transaction_type::varchar(100),
            row.usage_start_time::timestamptz,
            row.usage_end_time::timestamptz,
            row.invoice_month::varchar(7),
            row.region::varchar(50),
            row.tags,
            row.raw_payload
          FROM jsonb_to_recordset(${rows}::jsonb) AS row(
            account_id text,
            billing_account_name text,
            subaccount_id text,
            project_name text,
            resource_id text,
            product_id text,
            service_description text,
            meter_id text,
            sku_description text,
            usage_amount text,
            usage_unit text,
            pricing_usage_amount text,
            pricing_usage_unit text,
            cost text,
            list_cost text,
            credit_amount text,
            cost_after_credit text,
            currency text,
            currency_conversion_rate text,
            credit_breakdown jsonb,
            transaction_type text,
            usage_start_time text,
            usage_end_time text,
            invoice_month text,
            region text,
            tags jsonb,
            raw_payload jsonb
          )
        `;
      },
      {
        maxWait: BILLING_INGEST_TRANSACTION_MAX_WAIT_MS,
        timeout: statementTimeoutMs + 5_000,
      }
    );
  };

  const activateLoadedBatch = async (batchId: string) => {
    return prisma.$transaction(
      async (tx) => {
        await tx.billingIngestionBatch.updateMany({
          where: {
            ...sameSourceWhere,
            id: { not: batchId },
            isActive: true,
          },
          data: {
            isActive: false,
            supersededAt: new Date(),
          },
        });

        return tx.billingIngestionBatch.update({
          where: { id: batchId },
          data: {
            rowCount: result.lineItems.length,
            isActive: true,
            supersededAt: null,
          },
        });
      },
      {
        maxWait: BILLING_INGEST_TRANSACTION_MAX_WAIT_MS,
        timeout: 30_000,
      }
    );
  };

  const existingBatch = await prisma.billingIngestionBatch.findFirst({
    where: uniqueBatchWhere,
  });
  const incompleteBatchStaleBefore = new Date(
    Date.now() - Math.max(60_000, BILLING_INCOMPLETE_BATCH_STALE_AFTER_MS)
  );

  if (existingBatch) {
    if (!(await isCompleteBatch(existingBatch))) {
      if (!existingBatch.isActive) {
        if (existingBatch.updatedAt <= incompleteBatchStaleBefore) {
          const cleanupResult = await cleanupIncompleteBatch(
            existingBatch.id,
            incompleteBatchStaleBefore
          );
          if (cleanupResult.count !== 1) {
            throw new Error(
              `Billing ingestion batch ${existingBatch.id} for ${adapter.provider} ${month} is already loading`
            );
          }
        } else {
          throw new Error(
            `Billing ingestion batch ${existingBatch.id} for ${adapter.provider} ${month} is already loading`
          );
        }
      } else {
        throw new Error(
          `Existing active batch ${existingBatch.id} for ${adapter.provider} ${month} is incomplete`
        );
      }
    } else {
      return reuseBatch(
        existingBatch.id,
        `Reusing active batch for ${adapter.provider} ${month} with same checksum`
      );
    }
  }

  const incompleteBatchAfterCleanup = await prisma.billingIngestionBatch.findFirst({
    where: uniqueBatchWhere,
  });

  if (incompleteBatchAfterCleanup) {
    if (await isCompleteBatch(incompleteBatchAfterCleanup)) {
      return reuseBatch(
        incompleteBatchAfterCleanup.id,
        `Reusing active batch for ${adapter.provider} ${month} after incomplete batch cleanup race`
      );
    }
    throw new Error(
      `Billing ingestion batch ${incompleteBatchAfterCleanup.id} for ${adapter.provider} ${month} is already loading`
    );
  }

  // Create inactive batch first, load line items in chunks, then activate in a short transaction.
  let batchId: string | null = null;
  try {
    const batch = await prisma.billingIngestionBatch.create({
      data: {
        provider: adapter.provider,
        sourceType: adapter.sourceType,
        invoiceMonth: month,
        rowCount: 0,
        checksum: result.checksum,
        sourceMetadata: result.sourceMetadata as Prisma.InputJsonValue,
        isActive: false,
        supersededAt: null,
        createdBy: userId,
      },
    });
    batchId = batch.id;

    for (let offset = 0; offset < result.lineItems.length; offset += BILLING_LINE_ITEM_INSERT_CHUNK_SIZE) {
      const chunk = result.lineItems.slice(offset, offset + BILLING_LINE_ITEM_INSERT_CHUNK_SIZE);
      await bulkInsertLineItemChunk(batch.id, chunk);
      const heartbeat = await prisma.billingIngestionBatch.updateMany({
        where: { id: batch.id, isActive: false },
        data: { updatedAt: new Date() },
      });
      if (heartbeat.count !== 1) {
        throw new Error(`Billing ingestion batch ${batch.id} lost its loading lease`);
      }
    }

    const loadedLineItemCount = await prisma.billingLineItem.count({
      where: { ingestionBatchId: batch.id },
    });
    if (loadedLineItemCount !== result.lineItems.length) {
      throw new Error(
        `Loaded ${loadedLineItemCount} line items for batch ${batch.id}, expected ${result.lineItems.length}`
      );
    }

    const activeBatch = await withTransientPrismaRetry(() => activateLoadedBatch(batch.id));

    console.log(`Ingested ${result.lineItems.length} line items from ${adapter.provider} for ${month}`);
    return { batchId: activeBatch.id, rowCount: activeBatch.rowCount };
  } catch (error) {
    if (batchId) {
      await cleanupIncompleteBatch(batchId).catch((cleanupError) => {
        console.error('Failed to clean up incomplete billing ingestion batch:', cleanupError);
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const racedBatch = await prisma.billingIngestionBatch.findFirst({
        where: uniqueBatchWhere,
      });

      if (racedBatch && (await isCompleteBatch(racedBatch))) {
        return reuseBatch(
          racedBatch.id,
          `Reusing active batch for ${adapter.provider} ${month} after duplicate create race`
        );
      }
      if (racedBatch) {
        throw new Error(
          `Billing ingestion batch ${racedBatch.id} for ${adapter.provider} ${month} is already loading`
        );
      }
    }

    throw error;
  }
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
    } else if (options.sourceType === BillingSourceType.BIGQUERY_EXPORT) {
      lineItemFilter.ingestionBatch = { isActive: true };
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

    // Get customers with their project bindings.
    // After the binding refactor, CustomerProject.projectId IS the GCP string
    // (was UUID FK to Project). No nested project join needed.
    const customers = await prisma.customer.findMany({
      where: customerFilter,
      include: {
        customerProjects: {
          where: { isActive: true },
          select: {
            projectId: true,
            startDate: true,
            endDate: true,
          },
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
        const projectIds = activeBindings.map((cp) => cp.projectId);
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

        // Per-entry priced cost ≈ raw × (group.priced / group.raw) — used by
        // credits with optional SKU/group/project scope filters.
        const pricedEntries: PricedCostEntry[] = entriesAfterSpecialRules.map((e) => {
          const groupCode = e.skuGroupCode ?? 'UNMAPPED';
          const summary = pricingResult.skuGroupSummary[groupCode];
          let pricedCost = e.cost;
          if (summary) {
            const rawTotal = new Prisma.Decimal(summary.rawTotal);
            if (rawTotal.gt(0)) {
              const pricedTotal = new Prisma.Decimal(summary.pricedTotal);
              pricedCost = e.cost.mul(pricedTotal).div(rawTotal);
            }
          }
          return {
            skuId: e.skuId,
            skuGroupId: e.skuGroupId ?? null,
            projectId: e.projectId,
            cost: pricedCost,
          };
        });

        // Apply credits
        const creditResult = await applyCreditsToInvoice(
          customer.id,
          invoice.id,
          invoiceRunId,
          customerPricedTotal,
          billingMonth,
          pricedEntries
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
                    creditTypes: c.creditTypes,
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
