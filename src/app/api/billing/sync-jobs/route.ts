/**
 * /api/billing/sync-jobs
 *
 * Creates and lists background BigQuery billing sync jobs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { BillingSyncJobStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { badRequest, success } from '@/lib/utils';
import { serializeBillingSyncJob, startBillingSyncJob } from '@/lib/billing/sync-jobs';

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

    const existingJob = await prisma.billingSyncJob.findFirst({
      where: {
        billingMonth,
        connectionId: connectionId ?? null,
        customerId: customerId ?? null,
        status: { in: [BillingSyncJobStatus.QUEUED, BillingSyncJobStatus.RUNNING] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingJob) {
      startBillingSyncJob(existingJob.id);
      return NextResponse.json(
        {
          message: 'Billing sync job is already running',
          job: serializeBillingSyncJob(existingJob),
        },
        { status: 202 }
      );
    }

    const job = await prisma.billingSyncJob.create({
      data: {
        billingMonth,
        connectionId: connectionId ?? null,
        customerId: customerId ?? null,
        createdBy: context.auth.userId,
      },
    });

    startBillingSyncJob(job.id);

    return NextResponse.json(
      {
        message: 'Billing sync job started',
        job: serializeBillingSyncJob(job),
      },
      { status: 202 }
    );
  }
);
