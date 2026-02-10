/**
 * /api/invoice-runs/[id]
 *
 * Single invoice run management endpoints.
 *
 * GET - Get invoice run details with generated invoices
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { success, notFound, serverError } from '@/lib/utils';

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/invoice-runs/[id]
 *
 * Get a single invoice run with its generated invoices.
 */
export const GET = withPermission(
  { resource: 'invoice_runs', action: 'read' },
  async (request: NextRequest, context, routeContext?: RouteParams): Promise<NextResponse> => {
    try {
      const { id } = await routeContext!.params;

      const invoiceRun = await prisma.invoiceRun.findUnique({
        where: { id },
        include: {
          creator: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          invoices: {
            include: {
              customer: {
                select: {
                  id: true,
                  name: true,
                  externalId: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!invoiceRun) {
        return notFound('Invoice run not found');
      }

      // Transform response
      const data = {
        id: invoiceRun.id,
        billingMonth: invoiceRun.billingMonth,
        status: invoiceRun.status,
        configSnapshotId: invoiceRun.configSnapshotId,
        createdBy: invoiceRun.creator,
        startedAt: invoiceRun.startedAt,
        finishedAt: invoiceRun.finishedAt,
        errorMessage: invoiceRun.errorMessage,
        totalInvoices: invoiceRun.totalInvoices ?? invoiceRun.invoices.length,
        totalAmount: invoiceRun.totalAmount?.toString(),
        // Phase 2.6 metadata
        sourceKey: invoiceRun.sourceKey,
        sourceIngestionBatchIds: invoiceRun.sourceIngestionBatchIds,
        sourceTimeRangeStart: invoiceRun.sourceTimeRangeStart,
        sourceTimeRangeEnd: invoiceRun.sourceTimeRangeEnd,
        customerCount: invoiceRun.customerCount,
        projectCount: invoiceRun.projectCount,
        rowCount: invoiceRun.rowCount,
        currencyBreakdown: invoiceRun.currencyBreakdown,
        createdAt: invoiceRun.createdAt,
        updatedAt: invoiceRun.updatedAt,
        // Generated invoices
        invoices: invoiceRun.invoices.map((inv) => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          customerId: inv.customerId,
          customerName: inv.customer.name,
          customerExternalId: inv.customer.externalId,
          status: inv.status,
          subtotal: inv.subtotal.toString(),
          taxAmount: inv.taxAmount.toString(),
          totalAmount: inv.totalAmount.toString(),
          currency: inv.currency,
          issueDate: inv.issueDate,
          dueDate: inv.dueDate,
          lockedAt: inv.lockedAt,
          createdAt: inv.createdAt,
        })),
      };

      return success(data);

    } catch (error) {
      console.error('Failed to get invoice run:', error);
      return serverError('Failed to retrieve invoice run');
    }
  }
);
