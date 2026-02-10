/**
 * /api/invoice-runs/:id/execute (Phase 3 - Pricing Engine)
 *
 * Execute an invoice run - generate invoices for the billing month.
 *
 * POST - Execute the invoice run
 *
 * Phase 3 Features:
 * - Applies customer pricing rules (LIST_DISCOUNT)
 * - Returns raw vs priced totals for transparency
 * - SKU Group breakdown in invoice metadata
 *
 * Phase 2.6 Features:
 * - Returns full metadata: customerCount, projectCount, rowCount, currencyBreakdown
 * - Audit logging for RUN_COMPLETE and RUN_FAILED
 * - Detailed error information in responses
 *
 * Optional body:
 * - ingestionBatchId: string - If provided, only use this batch for cost data
 * - targetCustomerId: string - If provided, only process this customer
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logInvoiceRunComplete, logInvoiceRunFailed } from '@/lib/audit';
import { executeInvoiceRun } from '@/lib/billing';
import { generateAnalyticsSnapshots } from '@/lib/analytics/pipeline';
import { success, serverError, notFound, badRequest } from '@/lib/utils';
import { InvoiceRunStatus } from '@prisma/client';
import { z } from 'zod';

const executeSchema = z.object({
  ingestionBatchId: z.string().uuid().optional(),
  targetCustomerId: z.string().uuid().optional(),
}).optional();

/**
 * POST /api/invoice-runs/:id/execute
 *
 * Execute an invoice run.
 * Requires invoice_runs:execute permission.
 *
 * Business rules:
 * - Only QUEUED runs can be executed
 * - If ingestionBatchId provided, only that batch is used
 * - Otherwise, uses time range filter based on billing month
 */
export const POST = withPermission(
  { resource: 'invoice_runs', action: 'execute' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const invoiceRunId = context.params.id;

      // Parse optional body
      let body: z.infer<typeof executeSchema> = {};
      try {
        const text = await request.text();
        if (text) {
          body = executeSchema.parse(JSON.parse(text));
        }
      } catch {
        // Empty body is fine
      }

      // Get the invoice run
      const invoiceRun = await prisma.invoiceRun.findUnique({
        where: { id: invoiceRunId },
      });

      if (!invoiceRun) {
        return notFound('Invoice run not found');
      }

      // Validate status
      if (invoiceRun.status !== InvoiceRunStatus.QUEUED) {
        return badRequest(
          `Cannot execute invoice run in status '${invoiceRun.status}'. Only QUEUED runs can be executed.`
        );
      }

      // If ingestionBatchId provided, verify it exists
      if (body?.ingestionBatchId) {
        const batch = await prisma.rawCostIngestionBatch.findUnique({
          where: { id: body.ingestionBatchId },
        });
        if (!batch) {
          return notFound(`Ingestion batch '${body.ingestionBatchId}' not found`);
        }
      }

      // Execute the billing engine with optional targeting
      const result = await executeInvoiceRun(
        invoiceRunId,
        invoiceRun.billingMonth,
        {
          ingestionBatchId: body?.ingestionBatchId,
          targetCustomerId: body?.targetCustomerId,
        }
      );

      // Phase 2.6: Enhanced audit logging with metadata
      if (result.success) {
        await logInvoiceRunComplete(
          context,
          invoiceRunId,
          'SUCCEEDED',
          result.invoicesGenerated,
          result.totalAmount.toString(),
          {
            customerCount: result.metadata.customerCount,
            projectCount: result.metadata.projectCount,
            rowCount: result.metadata.rowCount,
            currencyBreakdown: result.metadata.currencyBreakdown,
            ingestionBatchIds: result.metadata.ingestionBatchIds,
          }
        );

        // Phase 7: Generate analytics snapshots on successful run
        try {
          const analyticsResult = await generateAnalyticsSnapshots(invoiceRunId);
          console.log(
            `Analytics snapshots generated: ${analyticsResult.monthlySummaryCount} summaries, ` +
            `${analyticsResult.customerSnapshotCount} customer snapshots, ` +
            `${analyticsResult.providerSnapshotCount} provider snapshots`
          );
        } catch (analyticsError) {
          // Log but don't fail the run - analytics is secondary
          console.error('Failed to generate analytics snapshots:', analyticsError);
        }
      } else {
        await logInvoiceRunFailed(
          context,
          invoiceRunId,
          result.errors.join('; '),
          {
            errors: result.errors,
            partialInvoices: result.invoicesGenerated,
            metadata: result.metadata,
          }
        );
      }

      // Return result with Phase 3 pricing metadata
      if (result.success) {
        return success({
          message: 'Invoice run executed successfully',
          invoiceRunId: result.invoiceRunId,
          status: 'SUCCEEDED',
          invoicesGenerated: result.invoicesGenerated,
          // Phase 3: Include raw and priced totals
          rawTotalAmount: result.rawTotalAmount.toString(),
          totalAmount: result.totalAmount.toString(),
          totalDiscount: result.metadata.totalDiscount,
          pricingApplied: result.metadata.pricingApplied,
          // Phase 2.6 metadata
          metadata: {
            customerCount: result.metadata.customerCount,
            projectCount: result.metadata.projectCount,
            rowCount: result.metadata.rowCount,
            currencyBreakdown: result.metadata.currencyBreakdown,
            ingestionBatchIds: result.metadata.ingestionBatchIds,
            costDataTimeRange: result.metadata.costDataTimeRange,
          },
        });
      } else {
        return success({
          message: 'Invoice run completed with errors',
          invoiceRunId: result.invoiceRunId,
          status: 'FAILED',
          invoicesGenerated: result.invoicesGenerated,
          rawTotalAmount: result.rawTotalAmount.toString(),
          totalAmount: result.totalAmount.toString(),
          totalDiscount: result.metadata.totalDiscount,
          pricingApplied: result.metadata.pricingApplied,
          errors: result.errors,
          // Phase 2.6 metadata
          metadata: {
            customerCount: result.metadata.customerCount,
            projectCount: result.metadata.projectCount,
            rowCount: result.metadata.rowCount,
            currencyBreakdown: result.metadata.currencyBreakdown,
            ingestionBatchIds: result.metadata.ingestionBatchIds,
            costDataTimeRange: result.metadata.costDataTimeRange,
          },
        });
      }

    } catch (error) {
      console.error('Failed to execute invoice run:', error);
      return serverError('Failed to execute invoice run');
    }
  }
);
