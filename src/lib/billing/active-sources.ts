import {
  BillingProvider,
  BillingSourceType,
  InvoiceRunStatus,
  InvoiceStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/db';

type BillingMonthLockOptions = {
  customerId?: string;
  customerIds?: string[];
};

export type BigQueryProjectOverlap = {
  projectId: string;
  distinctSourceCount: number;
  totalRows: number;
  sourceLabels: string[];
  sources: Array<{
    ingestionBatchId: string;
    sourceLabel: string;
    rowCount: number;
  }>;
};

function invoiceCustomerFilter(options: BillingMonthLockOptions): Prisma.InvoiceWhereInput {
  if (options.customerId) return { customerId: options.customerId };
  if (options.customerIds && options.customerIds.length > 0) {
    return { customerId: { in: options.customerIds } };
  }
  return {};
}

function invoiceRunCustomerFilter(options: BillingMonthLockOptions): Prisma.InvoiceRunWhereInput {
  if (options.customerId) {
    return {
      OR: [
        { targetCustomerId: options.customerId },
        { targetCustomerId: null },
      ],
    };
  }

  if (options.customerIds && options.customerIds.length > 0) {
    return {
      OR: [
        { targetCustomerId: { in: options.customerIds } },
        { targetCustomerId: null },
      ],
    };
  }

  return {};
}

export async function getBillingMonthLockReason(
  billingMonth: string,
  options: BillingMonthLockOptions = {}
): Promise<string | null> {
  const lockedInvoice = await prisma.invoice.findFirst({
    where: {
      billingMonth,
      status: InvoiceStatus.LOCKED,
      ...invoiceCustomerFilter(options),
    },
    select: { id: true, invoiceNumber: true },
  });
  if (lockedInvoice) {
    return `Billing month ${billingMonth} has locked invoice ${lockedInvoice.invoiceNumber}`;
  }

  const lockedRun = await prisma.invoiceRun.findFirst({
    where: {
      billingMonth,
      status: InvoiceRunStatus.LOCKED,
      ...invoiceRunCustomerFilter(options),
    },
    select: { id: true },
  });
  if (lockedRun) {
    return `Billing month ${billingMonth} has a locked invoice run`;
  }
  return null;
}

function sourceLabelFromMetadata(
  sourceMetadata: Prisma.JsonValue | null,
  batchId: string
): string {
  if (sourceMetadata && typeof sourceMetadata === 'object' && !Array.isArray(sourceMetadata)) {
    const metadata = sourceMetadata as Record<string, unknown>;
    if (typeof metadata.sourceKey === 'string' && metadata.sourceKey.trim()) {
      return metadata.sourceKey;
    }
    if (typeof metadata.source === 'string' && metadata.source.trim()) {
      return metadata.source;
    }
  }
  return batchId;
}

async function findProjectIdsForCustomers(
  customerIds?: string[]
): Promise<string[]> {
  if (customerIds?.length === 0) return [];

  const bindings = await prisma.customerProject.findMany({
    where: {
      isActive: true,
      ...(customerIds ? { customerId: { in: customerIds } } : {}),
    },
    select: { projectId: true },
  });

  return Array.from(new Set(bindings.map((binding) => binding.projectId)));
}

export async function findActiveBigQueryProjectOverlaps(
  billingMonth: string,
  options: { customerIds?: string[] } = {}
): Promise<BigQueryProjectOverlap[]> {
  const projectIds = await findProjectIdsForCustomers(options.customerIds);
  if (projectIds.length === 0) return [];

  const where: Prisma.BillingLineItemWhereInput = {
    provider: BillingProvider.GCP,
    sourceType: BillingSourceType.BIGQUERY_EXPORT,
    invoiceMonth: billingMonth,
    subaccountId: { in: projectIds },
    ingestionBatch: { isActive: true },
  };

  const grouped = await prisma.billingLineItem.groupBy({
    by: ['subaccountId', 'ingestionBatchId'],
    where,
    _count: { _all: true },
  });

  const rowsByProject = new Map<string, Array<{
    ingestionBatchId: string;
    rowCount: number;
  }>>();

  for (const group of grouped) {
    if (!group.subaccountId) continue;
    const rows = rowsByProject.get(group.subaccountId) ?? [];
    rows.push({
      ingestionBatchId: group.ingestionBatchId,
      rowCount: group._count._all,
    });
    rowsByProject.set(group.subaccountId, rows);
  }

  const overlappingEntries = Array.from(rowsByProject.entries())
    .filter(([, rows]) => rows.length > 1);

  if (overlappingEntries.length === 0) return [];

  const batchIds = Array.from(new Set(
    overlappingEntries.flatMap(([, rows]) => rows.map((row) => row.ingestionBatchId))
  ));
  const batches = await prisma.billingIngestionBatch.findMany({
    where: { id: { in: batchIds } },
    select: { id: true, sourceMetadata: true },
  });
  const batchLabelById = new Map(
    batches.map((batch) => [
      batch.id,
      sourceLabelFromMetadata(batch.sourceMetadata, batch.id),
    ])
  );

  return overlappingEntries
    .map(([projectId, rows]) => {
      const sources = rows.map((row) => ({
        ingestionBatchId: row.ingestionBatchId,
        sourceLabel: batchLabelById.get(row.ingestionBatchId) ?? row.ingestionBatchId,
        rowCount: row.rowCount,
      }));

      return {
        projectId,
        distinctSourceCount: sources.length,
        totalRows: sources.reduce((sum, source) => sum + source.rowCount, 0),
        sourceLabels: sources.map((source) => source.sourceLabel),
        sources,
      };
    })
    .sort((a, b) => b.totalRows - a.totalRows || a.projectId.localeCompare(b.projectId));
}
