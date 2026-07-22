/**
 * /api/credits/:id
 *
 * Individual credit management.
 *
 * GET   - Get credit details with ledger history
 * PATCH - Update credit configuration and balance
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { hasCustomerScope } from '@/lib/auth/context';
import { logCreditUpdate } from '@/lib/audit';
import { buildCreditUpdate } from '@/lib/credits/update';
import {
  validateBody,
  updateCreditSchema,
  validationError,
  success,
  serverError,
  notFound,
  forbidden,
  badRequest,
  conflict,
} from '@/lib/utils';

class CreditUpdateConflictError extends Error {}

/**
 * GET /api/credits/:id
 *
 * Get credit details including ledger entries.
 * Requires credits:read permission and customer scope.
 */
export const GET = withPermission(
  { resource: 'credits', action: 'read' },
  async (request, context): Promise<NextResponse> => {
    try {
      const creditId = context.params.id;

      // Fetch credit with ledger entries
      const credit = await prisma.credit.findUnique({
        where: { id: creditId },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
          matchSkuGroup: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          ledgerEntries: {
            orderBy: { appliedAt: 'desc' },
            include: {
              invoice: {
                select: {
                  id: true,
                  invoiceNumber: true,
                  billingMonth: true,
                },
              },
              invoiceRun: {
                select: {
                  id: true,
                  status: true,
                },
              },
            },
          },
        },
      });

      if (!credit) {
        return notFound('Credit not found');
      }

      // Check customer scope (unless super admin)
      if (!hasCustomerScope(context.auth, credit.customerId)) {
        return forbidden('Access denied to this credit');
      }

      // Transform ledger entries
      const ledgerHistory = credit.ledgerEntries.map((entry) => ({
        id: entry.id,
        appliedAmount: entry.appliedAmount.toString(),
        creditRemainingBefore: entry.creditRemainingBefore.toString(),
        appliedAt: entry.appliedAt,
        invoice: {
          id: entry.invoice.id,
          invoiceNumber: entry.invoice.invoiceNumber,
          billingMonth: entry.invoice.billingMonth,
        },
        invoiceRun: {
          id: entry.invoiceRun.id,
          status: entry.invoiceRun.status,
        },
      }));

      return success({
        id: credit.id,
        customerId: credit.customerId,
        customer: credit.customer,
        billingAccountId: credit.billingAccountId,
        types: credit.types,
        totalAmount: credit.totalAmount.toString(),
        remainingAmount: credit.remainingAmount.toString(),
        currency: credit.currency,
        validFrom: credit.validFrom.toISOString().split('T')[0],
        validTo: credit.validTo.toISOString().split('T')[0],
        allowCarryOver: credit.allowCarryOver,
        status: credit.status,
        sourceReference: credit.sourceReference,
        description: credit.description,
        matchSkuId: credit.matchSkuId,
        matchSkuGroupId: credit.matchSkuGroupId,
        matchSkuGroup: credit.matchSkuGroup,
        matchProjectId: credit.matchProjectId,
        createdAt: credit.createdAt,
        updatedAt: credit.updatedAt,
        ledgerHistory,
      });

    } catch (error) {
      console.error('Failed to get credit:', error);
      return serverError('Failed to retrieve credit');
    }
  }
);

/**
 * PATCH /api/credits/:id
 *
 * Update credit properties.
 * Requires credits:update permission and customer scope.
 *
 * Monetary, validity, status, type, carry-over, description, and scope fields
 * are editable. Every change is recorded in the audit log.
 */
export const PATCH = withPermission(
  { resource: 'credits', action: 'update' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const creditId = context.params.id;

      // Fetch existing credit
      const existingCredit = await prisma.credit.findUnique({
        where: { id: creditId },
      });

      if (!existingCredit) {
        return notFound('Credit not found');
      }

      // Check customer scope (unless super admin)
      if (!hasCustomerScope(context.auth, existingCredit.customerId)) {
        return forbidden('Access denied to this credit');
      }

      // Validate request body
      const validation = await validateBody(request, updateCreditSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const data = validation.data;

      if (data.matchSkuGroupId) {
        const skuGroup = await prisma.skuGroup.findUnique({
          where: { id: data.matchSkuGroupId },
          select: { id: true },
        });
        if (!skuGroup) {
          return notFound('SKU group not found');
        }
      }

      const update = buildCreditUpdate(existingCredit, data);
      if (!update.ok) return badRequest(update.error);
      const { updateData, beforeData, afterData, balanceAdjustment } = update;

      // Nothing to update
      if (Object.keys(updateData).length === 0) {
        return success({
          id: existingCredit.id,
          customerId: existingCredit.customerId,
          billingAccountId: existingCredit.billingAccountId,
          types: existingCredit.types,
          totalAmount: existingCredit.totalAmount.toString(),
          remainingAmount: existingCredit.remainingAmount.toString(),
          currency: existingCredit.currency,
          validFrom: existingCredit.validFrom.toISOString().split('T')[0],
          validTo: existingCredit.validTo.toISOString().split('T')[0],
          allowCarryOver: existingCredit.allowCarryOver,
          status: existingCredit.status,
          isActive: existingCredit.status === 'ACTIVE',
          sourceReference: existingCredit.sourceReference,
          description: existingCredit.description,
          matchSkuId: existingCredit.matchSkuId,
          matchSkuGroupId: existingCredit.matchSkuGroupId,
          matchProjectId: existingCredit.matchProjectId,
          updatedAt: existingCredit.updatedAt,
        });
      }

      const expectedUpdatedAt = new Date(data.expectedUpdatedAt);

      // The balance update, immutable adjustment entry, and audit event either
      // all commit or all roll back. updatedAt is the optimistic lock so a
      // stale admin form cannot overwrite invoice consumption or another edit.
      const updatedCredit = await prisma.$transaction(async (tx) => {
        const updated = await tx.credit.updateMany({
          where: {
            id: creditId,
            updatedAt: expectedUpdatedAt,
          },
          data: updateData as Prisma.CreditUpdateManyMutationInput,
        });

        if (updated.count !== 1) throw new CreditUpdateConflictError();

        if (balanceAdjustment) {
          await tx.creditBalanceAdjustment.create({
            data: {
              creditId,
              amountDelta: new Prisma.Decimal(balanceAdjustment.amountDelta),
              remainingBefore: new Prisma.Decimal(balanceAdjustment.remainingBefore),
              remainingAfter: new Prisma.Decimal(balanceAdjustment.remainingAfter),
              reason: balanceAdjustment.reason,
              adjustedBy: context.auth.userId,
            },
          });
        }

        await logCreditUpdate(context, creditId, beforeData, afterData, {
          db: tx,
          strict: true,
        });

        return tx.credit.findUniqueOrThrow({ where: { id: creditId } });
      });

      return success({
        id: updatedCredit.id,
        customerId: updatedCredit.customerId,
        billingAccountId: updatedCredit.billingAccountId,
        types: updatedCredit.types,
        totalAmount: updatedCredit.totalAmount.toString(),
        remainingAmount: updatedCredit.remainingAmount.toString(),
        currency: updatedCredit.currency,
        validFrom: updatedCredit.validFrom.toISOString().split('T')[0],
        validTo: updatedCredit.validTo.toISOString().split('T')[0],
        allowCarryOver: updatedCredit.allowCarryOver,
        status: updatedCredit.status,
        isActive: updatedCredit.status === 'ACTIVE',
        sourceReference: updatedCredit.sourceReference,
        description: updatedCredit.description,
        matchSkuId: updatedCredit.matchSkuId,
        matchSkuGroupId: updatedCredit.matchSkuGroupId,
        matchProjectId: updatedCredit.matchProjectId,
        updatedAt: updatedCredit.updatedAt,
      });

    } catch (error) {
      if (error instanceof CreditUpdateConflictError) {
        return conflict('Credit changed after this form was opened. Refresh and review the latest balance before saving again.');
      }
      console.error('Failed to update credit:', error);
      return serverError('Failed to update credit');
    }
  }
);
