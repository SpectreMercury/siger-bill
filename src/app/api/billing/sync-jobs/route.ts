/**
 * /api/billing/sync-jobs
 *
 * Creates and lists background BigQuery billing sync jobs.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  AuditAction,
  BillingSyncJobStatus,
  Prisma,
  type BillingSyncJob as BillingSyncJobModel,
} from '@prisma/client';
import { waitUntil } from '@vercel/functions';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { badRequest, serverError, success } from '@/lib/utils';
import { hasCustomerScope } from '@/lib/auth/context';
import { logAuditEvent } from '@/lib/audit';
import {
  canReadBillingSyncJob,
  runBillingSyncJob,
  serializeBillingSyncJob,
} from '@/lib/billing/sync-jobs';
import { prepareBillingSyncDispatch } from '@/lib/billing/sync-dispatch';
import {
  BigQueryBillingSyncError,
  resolveBigQueryBillingSyncConnectionIds,
} from '@/lib/billing/bigquery-sync';

export const maxDuration = 300;

const BILLING_SYNC_JOB_MIN_STALE_AFTER_MS = (maxDuration + 60) * 1_000;
const configuredStaleAfterMs = Number(
  process.env.BILLING_SYNC_JOB_STALE_AFTER_MS || 10 * 60 * 1_000
);
const BILLING_SYNC_JOB_STALE_AFTER_MS = Math.max(
  BILLING_SYNC_JOB_MIN_STALE_AFTER_MS,
  Number.isFinite(configuredStaleAfterMs) ? configuredStaleAfterMs : 10 * 60 * 1_000
);
const BILLING_SYNC_STALE_ERROR = 'Billing sync job exceeded its execution window and can be retried.';

const createSyncJobSchema = z.object({
  billingMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Must be YYYY-MM format'),
  connectionId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
});

export const GET = withPermission(
  { resource: 'raw_cost', action: 'read' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    const { searchParams } = new URL(request.url);
    const connectionId = searchParams.get('connectionId');
    const customerId = searchParams.get('customerId');
    const billingMonth = searchParams.get('billingMonth');
    const limit = Math.min(Number(searchParams.get('limit') || 20), 100);

    const jobs = await prisma.billingSyncJob.findMany({
      where: {
        ...(context.auth.isSuperAdmin ? {} : { createdBy: context.auth.userId }),
        ...(connectionId ? { connectionId } : {}),
        ...(customerId ? { customerId } : {}),
        ...(billingMonth ? { billingMonth } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Number.isFinite(limit) && limit > 0 ? limit : 20,
    });

    return success({ data: jobs.map(serializeBillingSyncJob) });
  }
);

export const POST = withPermission(
  { resource: 'raw_cost', action: 'import' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    const body = await request.json().catch(() => null);
    const validation = createSyncJobSchema.safeParse(body);
    if (!validation.success) {
      return badRequest('Invalid request body', { errors: validation.error.flatten() });
    }

    const { billingMonth, connectionId, customerId } = validation.data;

    if (connectionId && !context.auth.isSuperAdmin) {
      return NextResponse.json(
        { error: 'Only super admin can specify connectionId directly', code: 'SCOPE_DENIED' },
        { status: 403 }
      );
    }

    if (customerId && !context.auth.isSuperAdmin && !hasCustomerScope(context.auth, customerId)) {
      return NextResponse.json(
        { error: 'Access denied to this customer', code: 'SCOPE_DENIED' },
        { status: 403 }
      );
    }

    const now = new Date();
    const scopeKey = connectionId
      ? `connection:${connectionId}`
      : customerId
        ? `customer:${customerId}`
        : context.auth.isSuperAdmin
          ? 'global'
          : `creator:${context.auth.userId}`;
    let scopeConnectionIds: string[];
    try {
      scopeConnectionIds = await resolveBigQueryBillingSyncConnectionIds(
        { billingMonth, connectionId, customerId },
        context.auth
      );
    } catch (error) {
      if (error instanceof BigQueryBillingSyncError) {
        return NextResponse.json(
          {
            error: error.message,
            code: error.code ?? 'BILLING_SYNC_ERROR',
            details: error.details,
          },
          { status: error.status }
        );
      }
      console.error('Failed to resolve billing sync scope:', error);
      return serverError('Failed to resolve billing sync scope');
    }

    const dispatch = await prepareBillingSyncDispatch<BillingSyncJobModel>(
      {
        billingMonth,
        connectionId: connectionId ?? null,
        customerId: customerId ?? null,
        createdBy: context.auth.userId,
        scopeKey,
        scopeConnectionIds,
        now,
        staleAfterMs: BILLING_SYNC_JOB_STALE_AFTER_MS,
      },
      {
        withScopeLocks: (scopeKeys, operation) => prisma.$transaction(
          async (tx) => {
            for (const lockKey of scopeKeys) {
              await tx.$queryRaw`
                SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS locked
              `;
            }

            return operation({
              findActive: async (input) => {
                const where: Prisma.BillingSyncJobWhereInput = {
                  billingMonth: input.billingMonth,
                  status: { in: [BillingSyncJobStatus.QUEUED, BillingSyncJobStatus.RUNNING] },
                  OR: [
                    { scopeConnectionIds: { hasSome: input.scopeConnectionIds } },
                    {
                      scopeConnectionIds: { isEmpty: true },
                      OR: [
                        { connectionId: { in: input.scopeConnectionIds } },
                        { customer: { gcpConnectionId: { in: input.scopeConnectionIds } } },
                      ],
                    },
                  ],
                };
                const job = await tx.billingSyncJob.findFirst({
                  where,
                  orderBy: { createdAt: 'desc' },
                });
                if (!job || job.scopeConnectionIds.length > 0) return job;
                if (job.connectionId) {
                  return { ...job, scopeConnectionIds: [job.connectionId] };
                }
                if (job.customerId) {
                  const customer = await tx.customer.findUnique({
                    where: { id: job.customerId },
                    select: { gcpConnectionId: true },
                  });
                  if (customer?.gcpConnectionId) {
                    return { ...job, scopeConnectionIds: [customer.gcpConnectionId] };
                  }
                }
                return job;
              },
              expireStaleRunning: async (job, staleBefore) => {
                const expired = await tx.billingSyncJob.updateMany({
                  where: {
                    id: job.id,
                    status: BillingSyncJobStatus.RUNNING,
                    updatedAt: { lte: staleBefore },
                  },
                  data: {
                    status: BillingSyncJobStatus.FAILED,
                    errorMessage: BILLING_SYNC_STALE_ERROR,
                    errors: [BILLING_SYNC_STALE_ERROR],
                    finishedAt: now,
                  },
                });
                if (expired.count !== 1) return false;

                await logAuditEvent(
                  context,
                  {
                    action: AuditAction.UPDATE,
                    targetTable: 'billing_sync_jobs',
                    targetId: job.id,
                    beforeData: { status: BillingSyncJobStatus.RUNNING },
                    afterData: {
                      status: BillingSyncJobStatus.FAILED,
                      errorMessage: BILLING_SYNC_STALE_ERROR,
                    },
                    metadata: {
                      reason: 'stale_execution_window',
                      billingMonth,
                      connectionId: connectionId ?? null,
                      customerId: customerId ?? null,
                      scopeKey,
                      scopeConnectionIds,
                    },
                  },
                  { db: tx, strict: true }
                );
                return true;
              },
              create: (input) => tx.billingSyncJob.create({
                data: {
                  billingMonth: input.billingMonth,
                  connectionId: input.connectionId,
                  customerId: input.customerId,
                  createdBy: input.createdBy,
                  scopeKey: input.scopeKey,
                  scopeConnectionIds: input.scopeConnectionIds,
                },
              }),
            });
          },
          { maxWait: 10_000, timeout: 30_000 }
        ),
      }
    );

    const canReadDispatchedJob = canReadBillingSyncJob(dispatch.job, context.auth);
    if (dispatch.kind === 'conflict') {
      return NextResponse.json(
        {
          error: 'An overlapping billing sync job is already running. Retry after it finishes.',
          code: 'BILLING_SYNC_SCOPE_BUSY',
          ...(canReadDispatchedJob ? { job: serializeBillingSyncJob(dispatch.job) } : {}),
        },
        { status: 409 }
      );
    }

    if (dispatch.kind === 'existing' && !canReadDispatchedJob) {
      return NextResponse.json(
        {
          error: 'A broader billing sync is already running. Retry after it finishes.',
          code: 'BILLING_SYNC_SCOPE_BUSY',
        },
        { status: 409 }
      );
    }

    if (dispatch.shouldRun) {
      waitUntil(runBillingSyncJob(dispatch.job.id));
    }

    return NextResponse.json(
      {
        message: dispatch.kind === 'created'
          ? 'Billing sync job started'
          : 'Billing sync job is already running',
        job: serializeBillingSyncJob(dispatch.job),
      },
      { status: 202 }
    );
  }
);
