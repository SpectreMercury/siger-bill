/**
 * /api/raw-cost/import (Phase 2.6 Enterprise Ready)
 *
 * Raw cost data bulk import endpoint.
 * Imports GCP billing data for invoice generation.
 *
 * POST - Bulk import raw cost entries
 *
 * Phase 2.6 Features:
 * - Idempotency by (checksum, month, source) - returns existing batch if duplicate
 * - Audit logging for all imports
 * - Standardized error responses
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logAuditEvent } from '@/lib/audit';
import { AuditAction } from '@prisma/client';
import {
  validateBody,
  rawCostImportSchema,
  validationError,
  created,
  serverError,
  idempotentSuccess,
} from '@/lib/utils';
import { createHash } from 'crypto';

/**
 * POST /api/raw-cost/import
 *
 * Bulk import raw cost entries.
 * Requires raw_cost:import permission.
 *
 * Phase 2.6 Features:
 * - Idempotency by (checksum, month, source) unique constraint
 * - Returns existing batch with _idempotent flag if duplicate detected
 * - Audit logging for all imports
 */
export const POST = withPermission(
  { resource: 'raw_cost', action: 'import' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      // Validate request body
      const validation = await validateBody(request, rawCostImportSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const data = validation.data;

      // Compute checksum for idempotency (Phase 2.6)
      const entriesJson = JSON.stringify(data.entries);
      const checksum = createHash('sha256').update(entriesJson).digest('hex');

      // Derive month from entries if not provided
      const month = data.month ?? deriveMonthFromEntries(data.entries);

      // Phase 2.6: Check for idempotent duplicate by (checksum, month, source)
      const existingBatch = await prisma.rawCostIngestionBatch.findFirst({
        where: {
          checksum,
          month,
          source: data.source,
        },
      });

      if (existingBatch) {
        // Return existing batch with idempotent flag (200 OK)
        return idempotentSuccess({
          batchId: existingBatch.id,
          rowCount: existingBatch.rowCount,
          source: existingBatch.source,
          month: existingBatch.month,
          checksum: existingBatch.checksum,
          createdAt: existingBatch.createdAt,
        }, 'Batch already imported - idempotent duplicate detected');
      }

      // Create batch and entries in a transaction
      const result = await prisma.$transaction(async (tx) => {
        // Create ingestion batch with idempotency key
        const batch = await tx.rawCostIngestionBatch.create({
          data: {
            source: data.source,
            month,
            rowCount: data.entries.length,
            checksum,
            createdBy: context.auth.userId,
          },
        });

        // Prepare entries for bulk insert
        const entries = data.entries.map((entry) => ({
          ingestionBatchId: batch.id,
          billingAccountId: entry.billingAccountId,
          projectId: entry.projectId,
          serviceId: entry.serviceId,
          skuId: entry.skuId,
          usageStartTime: new Date(entry.usageStartTime),
          usageEndTime: new Date(entry.usageEndTime),
          usageAmount: entry.usageAmount,
          cost: entry.cost,
          currency: entry.currency,
          region: entry.region ?? null,
        }));

        // Bulk insert entries
        await tx.rawCostEntry.createMany({
          data: entries,
        });

        return batch;
      });

      // Audit log
      await logAuditEvent(context, {
        action: AuditAction.IMPORT,
        targetTable: 'raw_cost_ingestion_batches',
        targetId: result.id,
        afterData: {
          source: data.source,
          month,
          rowCount: data.entries.length,
          checksum,
        },
      });

      return created({
        message: 'Raw cost data imported successfully',
        batchId: result.id,
        rowCount: result.rowCount,
        source: result.source,
        month: result.month,
        checksum: result.checksum,
        createdAt: result.createdAt,
      });

    } catch (error) {
      console.error('Failed to import raw cost data:', error);
      return serverError('Failed to import raw cost data');
    }
  }
);

/**
 * Derive billing month from entries (uses first entry's usageStartTime)
 */
function deriveMonthFromEntries(entries: { usageStartTime: string }[]): string | undefined {
  if (entries.length === 0) return undefined;
  const firstDate = new Date(entries[0].usageStartTime);
  const year = firstDate.getUTCFullYear();
  const month = (firstDate.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${year}-${month}`;
}
