/**
 * /api/invoices/:id/lock
 *
 * Invoice locking endpoint for audit compliance.
 *
 * POST - Lock an invoice (immutable after lock)
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermissionAndScope } from '@/lib/middleware';
import { logInvoiceLock } from '@/lib/audit';
import { success, serverError, notFound, conflict } from '@/lib/utils';
import { InvoiceStatus } from '@prisma/client';

/**
 * POST /api/invoices/:id/lock
 *
 * Lock an invoice for audit compliance.
 * Requires invoices:lock permission and customer scope.
 *
 * Business rules:
 * - Any non-locked invoice can be locked (DRAFT, ISSUED, PAID, CANCELLED)
 * - Locking is irreversible
 * - Sets status to LOCKED, lockedAt, and lockedBy
 * - Once locked, invoice MUST NOT be modified by any endpoint
 *
 * Uses transaction to prevent race conditions on concurrent lock attempts.
 */
export const POST = withPermissionAndScope(
  { resource: 'invoices', action: 'lock' },
  async (_request, routeParams) => {
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

      // Execute lock in a transaction to handle concurrency
      const result = await prisma.$transaction(async (tx) => {
        // Get the invoice with a select for update (implicit in transaction)
        const invoice = await tx.invoice.findUnique({
          where: { id: invoiceId },
          include: {
            customer: { select: { name: true } },
          },
        });

        if (!invoice) {
          return { error: 'not_found' } as const;
        }

        // Check if already locked
        if (invoice.status === InvoiceStatus.LOCKED || invoice.lockedAt !== null) {
          return { error: 'already_locked', invoice } as const;
        }

        // Lock the invoice
        const lockedInvoice = await tx.invoice.update({
          where: { id: invoiceId },
          data: {
            status: InvoiceStatus.LOCKED,
            lockedAt: new Date(),
            lockedBy: context.auth.userId,
          },
        });

        return { success: true, invoice, lockedInvoice } as const;
      });

      // Handle transaction result
      if ('error' in result) {
        if (result.error === 'not_found') {
          return notFound('Invoice not found');
        }
        if (result.error === 'already_locked') {
          return conflict(`Invoice is already locked (locked at ${result.invoice?.lockedAt?.toISOString()})`);
        }
      }

      if (!result.success || !result.lockedInvoice) {
        return serverError('Unexpected error during invoice lock');
      }

      // Audit log (outside transaction)
      await logInvoiceLock(context, invoiceId);

      return success({
        message: 'Invoice locked successfully',
        id: result.lockedInvoice.id,
        invoiceNumber: result.lockedInvoice.invoiceNumber,
        status: result.lockedInvoice.status,
        lockedAt: result.lockedInvoice.lockedAt,
        lockedBy: context.auth.userId,
        customer: result.invoice.customer.name,
      });

    } catch (error) {
      console.error('Failed to lock invoice:', error);
      return serverError('Failed to lock invoice');
    }
  }
);
