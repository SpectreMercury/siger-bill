import { prisma } from '@/lib/db';
import { loadAuthContext } from '@/lib/auth/context';
import { logAuditEventMinimal } from '@/lib/audit';
import { runBigQueryBillingSync } from '@/lib/billing/bigquery-sync';
import { AuditAction, BillingSyncJobStatus, Prisma } from '@prisma/client';

const runningJobs = new Set<string>();

export type SerializedBillingSyncJob = {
  id: string;
  billingMonth: string;
  connectionId: string | null;
  customerId: string | null;
  status: BillingSyncJobStatus;
  totalRows: number;
  batches: unknown;
  sourceConflictCount: number;
  sourceConflicts: unknown;
  errors: string[];
  errorMessage: string | null;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

type BillingSyncJobRecord = {
  id: string;
  billingMonth: string;
  connectionId: string | null;
  customerId: string | null;
  status: BillingSyncJobStatus;
  totalRows: number;
  batches: Prisma.JsonValue | null;
  sourceConflictCount: number;
  sourceConflicts: Prisma.JsonValue | null;
  errors: string[];
  errorMessage: string | null;
  createdBy: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  updatedAt: Date;
};

export function serializeBillingSyncJob(job: BillingSyncJobRecord): SerializedBillingSyncJob {
  return {
    id: job.id,
    billingMonth: job.billingMonth,
    connectionId: job.connectionId,
    customerId: job.customerId,
    status: job.status,
    totalRows: job.totalRows,
    batches: job.batches,
    sourceConflictCount: job.sourceConflictCount,
    sourceConflicts: job.sourceConflicts,
    errors: job.errors,
    errorMessage: job.errorMessage,
    createdBy: job.createdBy,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    updatedAt: job.updatedAt.toISOString(),
  };
}

export function startBillingSyncJob(jobId: string): void {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);

  setTimeout(() => {
    void runBillingSyncJob(jobId).finally(() => {
      runningJobs.delete(jobId);
    });
  }, 0);
}

async function markFailed(jobId: string, message: string, errors: string[] = []) {
  await prisma.billingSyncJob.update({
    where: { id: jobId },
    data: {
      status: BillingSyncJobStatus.FAILED,
      errorMessage: message,
      errors,
      finishedAt: new Date(),
    },
  });
}

export async function runBillingSyncJob(jobId: string): Promise<void> {
  const job = await prisma.billingSyncJob.findUnique({ where: { id: jobId } });
  if (!job) return;

  if (
    job.status === BillingSyncJobStatus.SUCCEEDED ||
    job.status === BillingSyncJobStatus.FAILED
  ) {
    return;
  }

  await prisma.billingSyncJob.update({
    where: { id: jobId },
    data: {
      status: BillingSyncJobStatus.RUNNING,
      startedAt: job.startedAt ?? new Date(),
      errorMessage: null,
      errors: [],
    },
  });

  const auth = await loadAuthContext(job.createdBy);
  if (!auth) {
    await markFailed(jobId, 'Job creator is inactive or no longer exists');
    return;
  }

  try {
    const result = await runBigQueryBillingSync(
      {
        billingMonth: job.billingMonth,
        connectionId: job.connectionId ?? undefined,
        customerId: job.customerId ?? undefined,
      },
      auth
    );

    const isFailed = result.batches.length === 0 && !!result.errors?.length;
    const status = isFailed ? BillingSyncJobStatus.FAILED : BillingSyncJobStatus.SUCCEEDED;

    await prisma.billingSyncJob.update({
      where: { id: jobId },
      data: {
        status,
        totalRows: result.totalRows,
        batches: result.batches as Prisma.InputJsonValue,
        sourceConflictCount: result.sourceConflictCount,
        sourceConflicts: result.sourceConflicts as Prisma.InputJsonValue,
        errors: result.errors ?? [],
        errorMessage: isFailed ? result.errors?.join('; ') : null,
        finishedAt: new Date(),
      },
    });

    await logAuditEventMinimal({
      actorId: job.createdBy,
      action: AuditAction.IMPORT,
      targetTable: 'billing_sync_jobs',
      targetId: jobId,
      metadata: {
        billingMonth: result.billingMonth,
        connectionId: job.connectionId,
        customerId: job.customerId,
        status,
        totalRows: result.totalRows,
        sourceConflictCount: result.sourceConflictCount,
        batchesCreated: result.batches.length,
        errors: result.errors,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markFailed(jobId, message, [message]);
    await logAuditEventMinimal({
      actorId: job.createdBy,
      action: AuditAction.IMPORT,
      targetTable: 'billing_sync_jobs',
      targetId: jobId,
      metadata: {
        billingMonth: job.billingMonth,
        connectionId: job.connectionId,
        customerId: job.customerId,
        status: BillingSyncJobStatus.FAILED,
        error: message,
      },
    });
  }
}
