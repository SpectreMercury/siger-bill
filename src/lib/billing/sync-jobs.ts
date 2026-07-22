import { prisma } from '@/lib/db';
import { hasCustomerScope, loadAuthContext } from '@/lib/auth/context';
import { logAuditEventMinimal } from '@/lib/audit';
import { runBigQueryBillingSync } from '@/lib/billing/bigquery-sync';
import type { AuthContext } from '@/lib/types';
import { AuditAction, BillingSyncJobStatus, Prisma } from '@prisma/client';

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

export function canReadBillingSyncJob(
  job: Pick<BillingSyncJobRecord, 'createdBy' | 'customerId'>,
  auth: AuthContext
): boolean {
  return auth.isSuperAdmin ||
    job.createdBy === auth.userId ||
    (!!job.customerId && hasCustomerScope(auth, job.customerId));
}

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

async function markFailed(
  jobId: string,
  message: string,
  errors: string[] = [],
  expectedStatus: BillingSyncJobStatus = BillingSyncJobStatus.RUNNING
) {
  return prisma.billingSyncJob.updateMany({
    where: { id: jobId, status: expectedStatus },
    data: {
      status: BillingSyncJobStatus.FAILED,
      errorMessage: message,
      errors,
      finishedAt: new Date(),
    },
  });
}

export async function runBillingSyncJob(jobId: string): Promise<void> {
  let job: Awaited<ReturnType<typeof prisma.billingSyncJob.findUnique>> = null;
  let claimed = false;
  try {
    job = await prisma.billingSyncJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== BillingSyncJobStatus.QUEUED) return;

    const claim = await prisma.billingSyncJob.updateMany({
      where: {
        id: jobId,
        status: BillingSyncJobStatus.QUEUED,
      },
      data: {
        status: BillingSyncJobStatus.RUNNING,
        startedAt: new Date(),
        finishedAt: null,
        errorMessage: null,
        errors: [],
      },
    });
    if (claim.count !== 1) return;
    claimed = true;

    const auth = await loadAuthContext(job.createdBy);
    if (!auth) {
      throw new Error('Job creator is inactive or no longer exists');
    }

    const result = await runBigQueryBillingSync(
      {
        billingMonth: job.billingMonth,
        connectionId: job.connectionId ?? undefined,
        customerId: job.customerId ?? undefined,
        resolvedConnectionIds: job.scopeConnectionIds.length > 0
          ? job.scopeConnectionIds
          : undefined,
      },
      auth
    );

    const isFailed = result.batches.length === 0 && !!result.errors?.length;
    const status = isFailed ? BillingSyncJobStatus.FAILED : BillingSyncJobStatus.SUCCEEDED;

    const finalized = await prisma.billingSyncJob.updateMany({
      where: { id: jobId, status: BillingSyncJobStatus.RUNNING },
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
    if (finalized.count !== 1) return;

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
    }).catch((auditError) => {
      console.error('Failed to audit completed billing sync job:', auditError);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Billing sync job ${jobId} failed:`, error);

    const expectedStatus = claimed
      ? BillingSyncJobStatus.RUNNING
      : BillingSyncJobStatus.QUEUED;
    const failed = await markFailed(jobId, message, [message], expectedStatus).catch((markError) => {
      console.error(`Failed to mark billing sync job ${jobId} as failed:`, markError);
      return { count: 0 };
    });
    if (failed.count !== 1) return;

    const failedJob = job ?? await prisma.billingSyncJob.findUnique({
      where: { id: jobId },
    }).catch((loadError) => {
      console.error(`Failed to reload billing sync job ${jobId} for audit:`, loadError);
      return null;
    });
    if (!failedJob) return;

    await logAuditEventMinimal({
      actorId: failedJob.createdBy,
      action: AuditAction.IMPORT,
      targetTable: 'billing_sync_jobs',
      targetId: jobId,
      metadata: {
        billingMonth: failedJob.billingMonth,
        connectionId: failedJob.connectionId,
        customerId: failedJob.customerId,
        status: BillingSyncJobStatus.FAILED,
        error: message,
      },
    }).catch((auditError) => {
      console.error('Failed to audit failed billing sync job:', auditError);
    });
  }
}
