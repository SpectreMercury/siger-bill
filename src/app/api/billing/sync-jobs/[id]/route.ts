/**
 * /api/billing/sync-jobs/:id
 *
 * Reads a background BigQuery billing sync job.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { notFound, success } from '@/lib/utils';
import { canReadBillingSyncJob, serializeBillingSyncJob } from '@/lib/billing/sync-jobs';

export const GET = withPermission(
  { resource: 'raw_cost', action: 'read' },
  async (_request: NextRequest, context): Promise<NextResponse> => {
    const job = await prisma.billingSyncJob.findUnique({
      where: { id: context.params.id },
    });

    if (!job) return notFound('Billing sync job not found');
    if (!canReadBillingSyncJob(job, context.auth)) {
      return NextResponse.json(
        { error: 'Access denied to this billing sync job', code: 'SCOPE_DENIED' },
        { status: 403 }
      );
    }

    return success({ job: serializeBillingSyncJob(job) });
  }
);
