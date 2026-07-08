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
  const [lockedInvoice, lockedRun] = await Promise.all([
    prisma.invoice.findFirst({
      where: {
        billingMonth,
        status: InvoiceStatus.LOCKED,
        ...invoiceCustomerFilter(options),
      },
      select: { id: true, invoiceNumber: true },
    }),
    prisma.invoiceRun.findFirst({
      where: {
        billingMonth,
        status: InvoiceRunStatus.LOCKED,
        ...invoiceRunCustomerFilter(options),
      },
      select: { id: true },
    }),
  ]);

  if (lockedInvoice) {
    return `Billing month ${billingMonth} has locked invoice ${lockedInvoice.invoiceNumber}`;
  }
  if (lockedRun) {
    return `Billing month ${billingMonth} has a locked invoice run`;
  }
  return null;
}

function billingMonthRange(billingMonth: string): { monthStart: Date; monthEnd: Date } {
  const [year, month] = billingMonth.split('-').map(Number);
  return {
    monthStart: new Date(Date.UTC(year, month - 1, 1)),
    monthEnd: new Date(Date.UTC(year, month, 1)),
  };
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
  billingMonth: string,
  customerIds?: string[]
): Promise<string[] | null> {
  if (!customerIds || customerIds.length === 0) return null;

  const { monthStart, monthEnd } = billingMonthRange(billingMonth);
  const bindings = await prisma.customerProject.findMany({
    where: {
      customerId: { in: customerIds },
      isActive: true,
      AND: [
        {
          OR: [
            { startDate: null },
            { startDate: { lt: monthEnd } },
          ],
        },
        {
          OR: [
            { endDate: null },
            { endDate: { gte: monthStart } },
          ],
        },
      ],
    },
    select: { projectId: true },
  });

  return Array.from(new Set(bindings.map((binding) => binding.projectId)));
}

export async function findActiveBigQueryProjectOverlaps(
  billingMonth: string,
  options: { customerIds?: string[] } = {}
): Promise<BigQueryProjectOverlap[]> {
  const projectIds = await findProjectIdsForCustomers(billingMonth, options.customerIds);
  if (projectIds && projectIds.length === 0) return [];

  const where: Prisma.BillingLineItemWhereInput = {
    provider: BillingProvider.GCP,
    sourceType: BillingSourceType.BIGQUERY_EXPORT,
    invoiceMonth: billingMonth,
    subaccountId: projectIds ? { in: projectIds } : { not: null },
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
