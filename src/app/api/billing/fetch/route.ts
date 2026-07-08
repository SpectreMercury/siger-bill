/**
 * /api/billing/fetch
 *
 * POST - Fetch billing data from BigQuery for a given billing month.
 *
 * Uses the customer's GcpConnection (or specified connectionId) to:
 * 1. Load BigQuery billing config from DB
 * 2. Create a BigQuery adapter with the connection's credentials
 * 3. Fetch and ingest billing data into BillingLineItem table
 *
 * Required body:
 * - billingMonth: string (YYYY-MM)
 *
 * Optional body:
 * - connectionId: string (UUID) - specific GcpConnection to use
 * - customerId: string (UUID) - fetch only for this customer's connection
 *
 * Returns: ingestion batch info
 */

import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/middleware';
import { logAuditEvent } from '@/lib/audit';
import { AuditAction } from '@prisma/client';
import { success, serverError, badRequest } from '@/lib/utils';
import { BigQueryBillingSyncError, runBigQueryBillingSync } from '@/lib/billing/bigquery-sync';
import { z } from 'zod';

export const maxDuration = 300;

const fetchSchema = z.object({
  billingMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Must be YYYY-MM format'),
  connectionId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
});

/**
 * POST /api/billing/fetch
 *
 * Fetch billing data from BigQuery and ingest into BillingLineItem table.
 * Requires raw_cost:import permission (reuses existing permission).
 */
export const POST = withPermission(
  { resource: 'raw_cost', action: 'import' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const body = await request.json();
      const validation = fetchSchema.safeParse(body);
      if (!validation.success) {
        return badRequest('Invalid request body', { errors: validation.error.flatten() });
      }

      const result = await runBigQueryBillingSync(validation.data, context.auth);

      // Audit log
      await logAuditEvent(context, {
        action: AuditAction.IMPORT,
        targetTable: 'billing_line_items',
        targetId: result.billingMonth,
        afterData: {
          billingMonth: result.billingMonth,
          connectionsProcessed: result.batches.length,
          batchesCreated: result.batches.length,
          totalRows: result.totalRows,
          sourceConflictCount: result.sourceConflictCount,
          sourceConflicts: result.sourceConflicts.slice(0, 20),
          errors: result.errors,
        },
      });

      return success(result);
    } catch (error) {
      if (error instanceof BigQueryBillingSyncError) {
        return NextResponse.json(
          {
            error: error.message,
            code: error.code ?? 'BILLING_SYNC_ERROR',
            details: error.details,
            timestamp: new Date().toISOString(),
          },
          { status: error.status }
        );
      }
      console.error('Failed to fetch billing data:', error);
      return serverError('Failed to fetch billing data');
    }
  }
);
