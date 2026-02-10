/**
 * /api/credits/:id
 *
 * Individual credit management.
 *
 * GET   - Get credit details with ledger history
 * PATCH - Update credit (status, validTo, allowCarryOver, description)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { hasCustomerScope } from '@/lib/auth/context';
import { logCreditUpdate } from '@/lib/audit';
import {
  validateBody,
  updateCreditSchema,
  validationError,
  success,
  serverError,
  notFound,
  forbidden,
  badRequest,
} from '@/lib/utils';

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
        type: credit.type,
        totalAmount: credit.totalAmount.toString(),
        remainingAmount: credit.remainingAmount.toString(),
        currency: credit.currency,
        validFrom: credit.validFrom.toISOString().split('T')[0],
        validTo: credit.validTo.toISOString().split('T')[0],
        allowCarryOver: credit.allowCarryOver,
        status: credit.status,
        sourceReference: credit.sourceReference,
        description: credit.description,
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
 * Requires credits:write permission and customer scope.
 *
 * Updateable fields:
 * - status: ACTIVE, EXPIRED, DEPLETED
 * - validTo: Extend or shorten validity period
 * - allowCarryOver: Toggle carry-over behavior
 * - description: Update description
 */
export const PATCH = withPermission(
  { resource: 'credits', action: 'write' },
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

      // Validate validTo if provided
      if (data.validTo) {
        const newValidTo = new Date(data.validTo);
        if (newValidTo <= existingCredit.validFrom) {
          return badRequest('validTo must be after validFrom');
        }
      }

      // Build update object
      const updateData: Record<string, unknown> = {};
      if (data.status !== undefined) updateData.status = data.status;
      if (data.validTo !== undefined) updateData.validTo = new Date(data.validTo);
      if (data.allowCarryOver !== undefined) updateData.allowCarryOver = data.allowCarryOver;
      if (data.description !== undefined) updateData.description = data.description;

      // Nothing to update
      if (Object.keys(updateData).length === 0) {
        return success({
          id: existingCredit.id,
          customerId: existingCredit.customerId,
          billingAccountId: existingCredit.billingAccountId,
          type: existingCredit.type,
          totalAmount: existingCredit.totalAmount.toString(),
          remainingAmount: existingCredit.remainingAmount.toString(),
          currency: existingCredit.currency,
          validFrom: existingCredit.validFrom.toISOString().split('T')[0],
          validTo: existingCredit.validTo.toISOString().split('T')[0],
          allowCarryOver: existingCredit.allowCarryOver,
          status: existingCredit.status,
          sourceReference: existingCredit.sourceReference,
          description: existingCredit.description,
          updatedAt: existingCredit.updatedAt,
        });
      }

      // Update credit
      const updatedCredit = await prisma.credit.update({
        where: { id: creditId },
        data: updateData,
      });

      // Build before/after data for audit
      const beforeData: Record<string, unknown> = {};
      const afterData: Record<string, unknown> = {};
      if (data.status !== undefined) {
        beforeData.status = existingCredit.status;
        afterData.status = updatedCredit.status;
      }
      if (data.validTo !== undefined) {
        beforeData.validTo = existingCredit.validTo.toISOString().split('T')[0];
        afterData.validTo = updatedCredit.validTo.toISOString().split('T')[0];
      }
      if (data.allowCarryOver !== undefined) {
        beforeData.allowCarryOver = existingCredit.allowCarryOver;
        afterData.allowCarryOver = updatedCredit.allowCarryOver;
      }
      if (data.description !== undefined) {
        beforeData.description = existingCredit.description;
        afterData.description = updatedCredit.description;
      }

      // Audit log
      await logCreditUpdate(context, creditId, beforeData, afterData);

      return success({
        id: updatedCredit.id,
        customerId: updatedCredit.customerId,
        billingAccountId: updatedCredit.billingAccountId,
        type: updatedCredit.type,
        totalAmount: updatedCredit.totalAmount.toString(),
        remainingAmount: updatedCredit.remainingAmount.toString(),
        currency: updatedCredit.currency,
        validFrom: updatedCredit.validFrom.toISOString().split('T')[0],
        validTo: updatedCredit.validTo.toISOString().split('T')[0],
        allowCarryOver: updatedCredit.allowCarryOver,
        status: updatedCredit.status,
        sourceReference: updatedCredit.sourceReference,
        description: updatedCredit.description,
        updatedAt: updatedCredit.updatedAt,
      });

    } catch (error) {
      console.error('Failed to update credit:', error);
      return serverError('Failed to update credit');
    }
  }
);
