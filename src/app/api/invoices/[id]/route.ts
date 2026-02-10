/**
 * /api/invoices/:id
 *
 * Single invoice endpoint.
 *
 * GET - Get invoice details with line items
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermissionAndScope } from '@/lib/middleware';
import { success, serverError, notFound } from '@/lib/utils';

/**
 * GET /api/invoices/:id
 *
 * Get detailed invoice information including line items.
 * Requires invoices:read permission and customer scope.
 */
export const GET = withPermissionAndScope(
  { resource: 'invoices', action: 'read' },
  async (_request, routeParams) => {
    // We need to fetch the invoice to get its customerId for scope check
    const invoiceId = routeParams?.params.id;
    if (!invoiceId) return null;
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { customerId: true },
    });
    return invoice?.customerId ?? null;
  },
  async (_request, context): Promise<NextResponse> => {
    try {
      const invoiceId = context.params.id;

      // Get full invoice with line items
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              externalId: true,
              domain: true,
              primaryContactName: true,
              primaryContactEmail: true,
            },
          },
          invoiceRun: {
            select: {
              id: true,
              billingMonth: true,
              status: true,
            },
          },
          lineItems: {
            orderBy: { lineNumber: 'asc' },
          },
        },
      });

      if (!invoice) {
        return notFound('Invoice not found');
      }

      // Transform response
      const data = {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        billingMonth: invoice.billingMonth,
        status: invoice.status,
        customer: invoice.customer,
        invoiceRun: invoice.invoiceRun,
        subtotal: invoice.subtotal.toString(),
        taxAmount: invoice.taxAmount.toString(),
        totalAmount: invoice.totalAmount.toString(),
        currency: invoice.currency,
        currencyBreakdown: invoice.currencyBreakdown,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        paidAt: invoice.paidAt,
        lockedAt: invoice.lockedAt,
        lineItems: invoice.lineItems.map((li) => ({
          id: li.id,
          lineNumber: li.lineNumber,
          description: li.description,
          quantity: li.quantity.toString(),
          unitPrice: li.unitPrice.toString(),
          amount: li.amount.toString(),
          metadata: li.metadata,
        })),
        createdAt: invoice.createdAt,
        updatedAt: invoice.updatedAt,
      };

      return success(data);

    } catch (error) {
      console.error('Failed to get invoice:', error);
      return serverError('Failed to retrieve invoice');
    }
  }
);
