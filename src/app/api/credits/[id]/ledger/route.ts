import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { hasCustomerScope } from '@/lib/auth/context';
import { withPermission } from '@/lib/middleware';
import { forbidden, notFound, serverError, success } from '@/lib/utils';

/**
 * GET /api/credits/:id/ledger
 *
 * Returns one chronological balance history that combines invoice usage with
 * manual administrator adjustments. The synthetic allocation row is derived
 * from the immutable history and current balance so the running balance can be
 * reconciled from the credit's creation onward.
 */
export const GET = withPermission(
  { resource: 'credits', action: 'read' },
  async (_request, context): Promise<NextResponse> => {
    try {
      const creditId = context.params.id;
      const credit = await prisma.credit.findUnique({
        where: { id: creditId },
        include: {
          ledgerEntries: {
            orderBy: { appliedAt: 'asc' },
            include: {
              invoice: {
                select: { id: true, invoiceNumber: true, billingMonth: true },
              },
            },
          },
          balanceAdjustments: {
            orderBy: { adjustedAt: 'asc' },
            include: {
              actor: {
                select: { id: true, email: true, firstName: true, lastName: true },
              },
            },
          },
        },
      });

      if (!credit) return notFound('Credit');
      if (!hasCustomerScope(context.auth, credit.customerId)) {
        return forbidden('Access denied to this credit');
      }

      const totalApplied = credit.ledgerEntries.reduce(
        (sum, entry) => sum.add(entry.appliedAmount),
        new Prisma.Decimal(0)
      );
      const totalAdjusted = credit.balanceAdjustments.reduce(
        (sum, entry) => sum.add(entry.amountDelta),
        new Prisma.Decimal(0)
      );
      const initialBalance = credit.remainingAmount.add(totalApplied).sub(totalAdjusted);

      const entries = [
        {
          id: `${credit.id}-allocation`,
          creditId: credit.id,
          type: 'ALLOCATION' as const,
          amount: initialBalance.toString(),
          balanceAfter: initialBalance.toString(),
          description: 'Initial credit balance',
          invoiceId: null,
          createdAt: credit.createdAt,
          actor: null,
        },
        ...credit.ledgerEntries.map((entry) => ({
          id: entry.id,
          creditId: credit.id,
          type: 'USAGE' as const,
          amount: entry.appliedAmount.negated().toString(),
          balanceAfter: entry.creditRemainingBefore.sub(entry.appliedAmount).toString(),
          description: `Applied to ${entry.invoice.invoiceNumber} (${entry.invoice.billingMonth})`,
          invoiceId: entry.invoice.id,
          createdAt: entry.appliedAt,
          actor: null,
        })),
        ...credit.balanceAdjustments.map((entry) => ({
          id: entry.id,
          creditId: credit.id,
          type: 'ADJUSTMENT' as const,
          amount: entry.amountDelta.toString(),
          balanceAfter: entry.remainingAfter.toString(),
          description: entry.reason,
          invoiceId: null,
          createdAt: entry.adjustedAt,
          actor: {
            id: entry.actor.id,
            email: entry.actor.email,
            name: `${entry.actor.firstName} ${entry.actor.lastName}`.trim(),
          },
        })),
      ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      return success({ data: entries });
    } catch (error) {
      console.error('Failed to get credit ledger:', error);
      return serverError('Failed to retrieve credit ledger');
    }
  }
);
