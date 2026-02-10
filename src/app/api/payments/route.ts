/**
 * /api/payments
 *
 * Payment tracking endpoints.
 *
 * GET  - List payments
 * POST - Record a new payment
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logCreate } from '@/lib/audit';
import {
  validateBody,
  paginationSchema,
  validationError,
  success,
  created,
  notFound,
  badRequest,
  serverError,
} from '@/lib/utils';
import { z } from 'zod';

/**
 * Payment creation schema
 */
const createPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().positive('Amount must be positive'),
  currency: z.string().length(3).default('USD'),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format'),
  reference: z.string().max(255).optional(),
  method: z.string().max(50).optional(),
  notes: z.string().optional(),
});

/**
 * GET /api/payments
 *
 * List payments with pagination and filtering.
 * Requires payments:list permission.
 */
export const GET = withPermission(
  { resource: 'invoices', action: 'read' },
  async (request: NextRequest): Promise<NextResponse> => {
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
      const invoiceId = searchParams.get('invoiceId');
      const customerId = searchParams.get('customerId');
      const startDate = searchParams.get('startDate');
      const endDate = searchParams.get('endDate');

      // Build where clause
      const where: Record<string, unknown> = {};

      if (invoiceId) {
        where.invoiceId = invoiceId;
      }

      if (customerId) {
        where.invoice = { customerId };
      }

      if (startDate || endDate) {
        where.paymentDate = {};
        if (startDate) {
          (where.paymentDate as Record<string, unknown>).gte = new Date(startDate);
        }
        if (endDate) {
          (where.paymentDate as Record<string, unknown>).lte = new Date(endDate);
        }
      }

      // Execute queries in parallel
      const [payments, total] = await Promise.all([
        prisma.payment.findMany({
          where,
          skip,
          take: limit,
          orderBy: { paymentDate: 'desc' },
          include: {
            invoice: {
              include: {
                customer: {
                  select: {
                    id: true,
                    name: true,
                    externalId: true,
                  },
                },
              },
            },
            recorder: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        }),
        prisma.payment.count({ where }),
      ]);

      const data = payments.map((payment) => ({
        id: payment.id,
        invoiceId: payment.invoiceId,
        invoiceNumber: payment.invoice.invoiceNumber,
        customer: payment.invoice.customer,
        amount: payment.amount.toString(),
        currency: payment.currency,
        paymentDate: payment.paymentDate,
        reference: payment.reference,
        method: payment.method,
        notes: payment.notes,
        recordedBy: payment.recorder,
        createdAt: payment.createdAt,
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
      console.error('Failed to list payments:', error);
      return serverError('Failed to retrieve payments');
    }
  }
);

/**
 * POST /api/payments
 *
 * Record a new payment against an invoice.
 * Requires payments:create permission.
 */
export const POST = withPermission(
  { resource: 'invoices', action: 'update' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      // Validate request body
      const validation = await validateBody(request, createPaymentSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const { invoiceId, amount, currency, paymentDate, reference, method, notes } = validation.data;

      // Verify invoice exists
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          customer: { select: { name: true } },
          payments: { select: { amount: true } },
        },
      });

      if (!invoice) {
        return notFound('Invoice not found');
      }

      // Check invoice status
      if (invoice.status === 'CANCELLED') {
        return badRequest('Cannot record payment for cancelled invoice');
      }

      if (invoice.status === 'PAID') {
        return badRequest('Invoice is already marked as paid');
      }

      // Calculate total paid so far
      const totalPaid = invoice.payments.reduce(
        (sum, p) => sum + Number(p.amount),
        0
      );
      const invoiceTotal = Number(invoice.totalAmount);
      const remainingBalance = invoiceTotal - totalPaid;

      // Validate payment amount
      if (amount > remainingBalance) {
        return badRequest(
          `Payment amount exceeds remaining balance. Remaining: ${remainingBalance.toFixed(2)}`,
          { remainingBalance }
        );
      }

      // Create payment
      const payment = await prisma.payment.create({
        data: {
          invoiceId,
          amount,
          currency,
          paymentDate: new Date(paymentDate),
          reference,
          method,
          notes,
          recordedBy: context.auth.userId,
        },
        include: {
          recorder: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      // Check if invoice is now fully paid
      const newTotalPaid = totalPaid + amount;
      if (newTotalPaid >= invoiceTotal) {
        await prisma.invoice.update({
          where: { id: invoiceId },
          data: {
            status: 'PAID',
            paidAt: new Date(),
          },
        });
      }

      // Audit log
      await logCreate(context, 'payments', payment.id, {
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customer.name,
        amount,
        reference,
      });

      return created({
        id: payment.id,
        invoiceId: payment.invoiceId,
        amount: payment.amount.toString(),
        currency: payment.currency,
        paymentDate: payment.paymentDate,
        reference: payment.reference,
        method: payment.method,
        recordedBy: payment.recorder,
        invoiceFullyPaid: newTotalPaid >= invoiceTotal,
        createdAt: payment.createdAt,
      });

    } catch (error) {
      console.error('Failed to create payment:', error);
      return serverError('Failed to record payment');
    }
  }
);
