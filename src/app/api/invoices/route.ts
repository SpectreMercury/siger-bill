/**
 * /api/invoices
 *
 * Invoice query endpoint.
 *
 * GET - List invoices with filters
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { buildCustomerScopeFilter } from '@/lib/auth/context';
import { paginationSchema, success, serverError } from '@/lib/utils';
import { InvoiceStatus } from '@prisma/client';

/**
 * GET /api/invoices
 *
 * List invoices with pagination and optional filters.
 * Requires invoices:list permission.
 * Results are scoped to user's customer access.
 *
 * Query params:
 *   - customerId: filter by customer
 *   - billingMonth: filter by billing month (YYYY-MM)
 *   - invoiceRunId: filter by invoice run
 *   - status: filter by status (DRAFT, ISSUED, PAID, CANCELLED, LOCKED)
 */
export const GET = withPermission(
  { resource: 'invoices', action: 'list' },
  async (request, context): Promise<NextResponse> => {
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

      // Build where clause
      const where: Record<string, unknown> = {};

      // Customer scope filter
      const scopeFilter = buildCustomerScopeFilter(context.auth);
      if (scopeFilter) {
        where.customerId = scopeFilter.customerId;
      }

      // Optional filters
      const customerId = searchParams.get('customerId');
      if (customerId) {
        // If user specifies a customer, intersect with their scope
        if (scopeFilter) {
          const scopedIds = scopeFilter.customerId.in;
          if (!scopedIds.includes(customerId)) {
            // User doesn't have access to this customer
            return success({
              data: [],
              pagination: { page, limit, total: 0, totalPages: 0 },
            });
          }
        }
        where.customerId = customerId;
      }

      const billingMonth = searchParams.get('billingMonth');
      if (billingMonth) {
        where.billingMonth = billingMonth;
      }

      const invoiceRunId = searchParams.get('invoiceRunId');
      if (invoiceRunId) {
        where.invoiceRunId = invoiceRunId;
      }

      const status = searchParams.get('status') as InvoiceStatus | null;
      if (status && Object.values(InvoiceStatus).includes(status)) {
        where.status = status;
      }

      // Execute queries in parallel
      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            customer: {
              select: {
                id: true,
                name: true,
                externalId: true,
              },
            },
            invoiceRun: {
              select: {
                id: true,
                billingMonth: true,
                status: true,
              },
            },
            _count: {
              select: { lineItems: true },
            },
          },
        }),
        prisma.invoice.count({ where }),
      ]);

      // Transform response
      const data = invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        billingMonth: inv.billingMonth,
        status: inv.status,
        customer: inv.customer,
        invoiceRun: inv.invoiceRun,
        subtotal: inv.subtotal.toString(),
        taxAmount: inv.taxAmount.toString(),
        totalAmount: inv.totalAmount.toString(),
        currency: inv.currency,
        currencyBreakdown: inv.currencyBreakdown,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        lineItemCount: inv._count.lineItems,
        lockedAt: inv.lockedAt,
        createdAt: inv.createdAt,
        updatedAt: inv.updatedAt,
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
      console.error('Failed to list invoices:', error);
      return serverError('Failed to retrieve invoices');
    }
  }
);
