/**
 * /api/invoice-runs (Phase 2.6 Enterprise Ready)
 *
 * Invoice batch run management endpoints.
 * These endpoints handle the monthly billing execution workflow.
 *
 * GET  - List invoice runs with metadata
 * POST - Create a new invoice run (queue for processing)
 *
 * Phase 2.6 Features:
 * - Idempotency: Prevents duplicate QUEUED/RUNNING runs for same (billingMonth, targetCustomerId, sourceKey)
 * - Audit logging: RUN_START on creation
 * - Metadata: Returns customerCount, projectCount, rowCount, currencyBreakdown
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logCreate, logInvoiceRunStart } from '@/lib/audit';
import { computeSourceKey } from '@/lib/billing';
import {
  validateBody,
  createInvoiceRunSchema,
  paginationSchema,
  validationError,
  success,
  created,
  serverError,
  conflict,
  idempotentSuccess,
} from '@/lib/utils';
import { InvoiceRunStatus } from '@prisma/client';

/**
 * GET /api/invoice-runs
 *
 * List invoice runs with pagination.
 * Requires invoice_runs:list permission.
 */
export const GET = withPermission(
  { resource: 'invoice_runs', action: 'list' },
  async (request, _context): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);

      // Parse pagination
      const pagination = paginationSchema.safeParse({
        page: searchParams.get('page'),
        limit: searchParams.get('limit'),
      });

      const page = pagination.success ? pagination.data.page : 1;
      const limit = pagination.success ? pagination.data.limit : 20;
      const skip = (page - 1) * limit;

      // Optional filters
      const billingMonth = searchParams.get('billingMonth');
      const status = searchParams.get('status') as InvoiceRunStatus | null;

      const where: Record<string, unknown> = {};
      if (billingMonth) {
        where.billingMonth = billingMonth;
      }
      if (status && Object.values(InvoiceRunStatus).includes(status)) {
        where.status = status;
      }

      // Execute queries in parallel
      const [invoiceRuns, total] = await Promise.all([
        prisma.invoiceRun.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            creator: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
            _count: {
              select: {
                invoices: true,
              },
            },
          },
        }),
        prisma.invoiceRun.count({ where }),
      ]);

      // Transform response with Phase 2.6 metadata
      const data = invoiceRuns.map((run) => ({
        id: run.id,
        billingMonth: run.billingMonth,
        status: run.status,
        configSnapshotId: run.configSnapshotId,
        createdBy: run.creator,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        errorMessage: run.errorMessage,
        totalInvoices: run.totalInvoices ?? run._count.invoices,
        totalAmount: run.totalAmount?.toString(),
        // Phase 2.6 metadata
        sourceKey: run.sourceKey,
        sourceIngestionBatchIds: run.sourceIngestionBatchIds,
        sourceTimeRangeStart: run.sourceTimeRangeStart,
        sourceTimeRangeEnd: run.sourceTimeRangeEnd,
        customerCount: run.customerCount,
        projectCount: run.projectCount,
        rowCount: run.rowCount,
        currencyBreakdown: run.currencyBreakdown,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      }));

      return success({
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });

    } catch (error) {
      console.error('Failed to list invoice runs:', error);
      return serverError('Failed to retrieve invoice runs');
    }
  }
);

/**
 * POST /api/invoice-runs
 *
 * Create a new invoice run for a billing month.
 * The run will be queued for processing.
 *
 * Requires invoice_runs:create permission.
 *
 * Phase 2.6 Business rules:
 * - Idempotency by (billingMonth, targetCustomerId, sourceKey)
 * - Returns existing run with 200 + _idempotent flag if duplicate detected
 * - Returns 409 Conflict if LOCKED run exists
 * - Returns 409 Conflict if QUEUED/RUNNING run exists (not idempotent match)
 *
 * Optional body fields:
 * - targetCustomerId: string - Scope run to specific customer
 * - ingestionBatchId: string - Use specific batch for cost data
 */
export const POST = withPermission(
  { resource: 'invoice_runs', action: 'create' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      // Validate request body
      const validation = await validateBody(request, createInvoiceRunSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const { billingMonth, targetCustomerId, ingestionBatchId } = validation.data;

      // Compute source key for idempotency
      const sourceKey = computeSourceKey(billingMonth, { ingestionBatchId });

      // Phase 2.6: Check for idempotent duplicate first
      // A run with same (billingMonth, targetCustomerId, sourceKey) is considered identical
      const idempotentMatch = await prisma.invoiceRun.findFirst({
        where: {
          billingMonth,
          targetCustomerId: targetCustomerId ?? null,
          sourceKey,
        },
        include: {
          creator: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      if (idempotentMatch) {
        // Return existing run with idempotent flag
        return idempotentSuccess({
          id: idempotentMatch.id,
          billingMonth: idempotentMatch.billingMonth,
          status: idempotentMatch.status,
          sourceKey: idempotentMatch.sourceKey,
          createdBy: idempotentMatch.creator,
          createdAt: idempotentMatch.createdAt,
        }, `Invoice run already exists for this configuration (status: ${idempotentMatch.status})`);
      }

      // Check for LOCKED runs (cannot create new runs for locked month)
      const lockedRun = await prisma.invoiceRun.findFirst({
        where: {
          billingMonth,
          status: InvoiceRunStatus.LOCKED,
        },
      });

      if (lockedRun) {
        return conflict(
          `Billing month ${billingMonth} is already locked. Cannot create new run.`,
          { existingRunId: lockedRun.id, status: 'LOCKED' }
        );
      }

      // Check for QUEUED/RUNNING runs with different sourceKey (conflict, not idempotent)
      const activeRun = await prisma.invoiceRun.findFirst({
        where: {
          billingMonth,
          status: {
            in: [InvoiceRunStatus.QUEUED, InvoiceRunStatus.RUNNING],
          },
        },
      });

      if (activeRun) {
        return conflict(
          `An invoice run for ${billingMonth} is already ${activeRun.status.toLowerCase()}. ` +
          `Please wait for it to complete or cancel it first.`,
          { existingRunId: activeRun.id, status: activeRun.status }
        );
      }

      // Create the invoice run in QUEUED status with sourceKey
      const invoiceRun = await prisma.invoiceRun.create({
        data: {
          billingMonth,
          status: InvoiceRunStatus.QUEUED,
          createdBy: context.auth.userId,
          targetCustomerId: targetCustomerId ?? null,
          sourceKey,
        },
        include: {
          creator: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      // Audit log: RUN_START
      await logCreate(context, 'invoice_runs', invoiceRun.id, {
        billingMonth,
        status: InvoiceRunStatus.QUEUED,
        sourceKey,
        targetCustomerId,
      });
      await logInvoiceRunStart(context, invoiceRun.id, billingMonth);

      return created({
        id: invoiceRun.id,
        billingMonth: invoiceRun.billingMonth,
        status: invoiceRun.status,
        sourceKey: invoiceRun.sourceKey,
        targetCustomerId: invoiceRun.targetCustomerId,
        createdBy: invoiceRun.creator,
        createdAt: invoiceRun.createdAt,
        message: 'Invoice run queued successfully. Processing will begin shortly.',
      });

    } catch (error) {
      console.error('Failed to create invoice run:', error);
      return serverError('Failed to create invoice run');
    }
  }
);
