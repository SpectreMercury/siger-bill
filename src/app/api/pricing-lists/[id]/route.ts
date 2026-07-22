/**
 * /api/pricing-lists/[id]
 *
 * Single pricing list operations.
 *
 * GET    - Get pricing list details
 * PUT    - Update pricing list
 * DELETE - Delete pricing list
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withPermissionAndScope } from '@/lib/middleware';
import { logUpdate, logDelete } from '@/lib/audit';
import { PricingBasis, PricingListStatus } from '@prisma/client';
import { normalizePricingBillingAccountIds } from '@/lib/pricing/billing-account-scope';
import {
  success,
  notFound,
  serverError,
  validationError,
  badRequest,
} from '@/lib/utils';

const updatePricingListSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  priceBasis: z.enum(['STANDARD', 'COST']).optional(),
  billingAccountIds: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
});

async function getCustomerIdFromPricingList(pricingListId: string): Promise<string | null> {
  const pricingList = await prisma.pricingList.findUnique({
    where: { id: pricingListId },
    select: { customerId: true },
  });
  return pricingList?.customerId ?? null;
}

function resolveCustomerId(_request: NextRequest, routeParams?: { params: Record<string, string> }) {
  const pricingListId = routeParams?.params.id;
  return pricingListId ? getCustomerIdFromPricingList(pricingListId) : null;
}

/**
 * GET /api/pricing-lists/[id]
 *
 * Get pricing list details with rules.
 */
export const GET = withPermissionAndScope(
  { resource: 'customers', action: 'read' },
  resolveCustomerId,
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id } = context.params;

      const pricingList = await prisma.pricingList.findUnique({
        where: { id },
        include: {
          customer: { select: { id: true, name: true, externalId: true } },
          pricingRules: {
            include: {
              skuGroups: {
                include: { skuGroup: { select: { id: true, code: true, name: true } } },
                orderBy: { skuGroup: { code: 'asc' } },
              },
            },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          },
        },
      });

      if (!pricingList) {
        return notFound('Pricing list not found');
      }

      return success({
        id: pricingList.id,
        name: pricingList.name,
        status: pricingList.status,
        priceBasis: pricingList.priceBasis,
        billingAccountIds: pricingList.billingAccountIds,
        isActive: pricingList.status === 'ACTIVE',
        customer: pricingList.customer,
        rules: pricingList.pricingRules.map((rule) => ({
          id: rule.id,
          isDefault: rule.isDefault,
          skuGroups: rule.skuGroups.map((g) => g.skuGroup),
          ruleType: rule.ruleType,
          discountRate: rule.discountRate ? rule.discountRate.toString() : null,
          discountPercent: rule.discountRate ? ((1 - Number(rule.discountRate)) * 100).toFixed(1) : null,
          unitPrice: rule.unitPrice ? rule.unitPrice.toString() : null,
          tiers: rule.tiers ?? null,
          effectiveStart: rule.effectiveStart,
          effectiveEnd: rule.effectiveEnd,
          createdAt: rule.createdAt,
        })),
        createdAt: pricingList.createdAt,
        updatedAt: pricingList.updatedAt,
      });
    } catch (error) {
      console.error('Failed to get pricing list:', error);
      return serverError('Failed to retrieve pricing list');
    }
  }
);

/**
 * PUT /api/pricing-lists/[id]
 *
 * Update pricing list name or status.
 */
export const PUT = withPermissionAndScope(
  { resource: 'customers', action: 'update' },
  resolveCustomerId,
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id } = context.params;
      const body = await request.json();
      const validation = updatePricingListSchema.safeParse(body);
      if (!validation.success) return validationError(validation.error);

      // Find existing
      const existing = await prisma.pricingList.findUnique({
        where: { id },
      });

      if (!existing) {
        return notFound('Pricing list not found');
      }

      const normalizedBillingAccountIds = validation.data.billingAccountIds === undefined
        ? undefined
        : normalizePricingBillingAccountIds(validation.data.billingAccountIds);
      if (normalizedBillingAccountIds && normalizedBillingAccountIds.length > 0) {
        const existingBillingAccounts = await prisma.billingAccount.findMany({
          where: { billingAccountId: { in: normalizedBillingAccountIds } },
          select: { billingAccountId: true },
        });
        const existingIds = new Set(existingBillingAccounts.map((account) => account.billingAccountId));
        const unknownIds = normalizedBillingAccountIds.filter(
          (billingAccountId) => !existingIds.has(billingAccountId)
        );
        if (unknownIds.length > 0) {
          return badRequest(`Unknown Billing ID: ${unknownIds.join(', ')}`);
        }
      }

      // Build update data
      const updateData: Record<string, unknown> = {};
      if (validation.data.name !== undefined) {
        updateData.name = validation.data.name;
      }
      if (validation.data.status) {
        updateData.status = validation.data.status as PricingListStatus;
      }
      if (validation.data.priceBasis) {
        updateData.priceBasis = validation.data.priceBasis as PricingBasis;
      }
      if (validation.data.billingAccountIds !== undefined) {
        updateData.billingAccountIds = normalizedBillingAccountIds;
      }

      // Update
      const updated = await prisma.pricingList.update({
        where: { id },
        data: updateData,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              externalId: true,
            },
          },
        },
      });

      // Audit log
      await logUpdate(
        context,
        'pricing_lists',
        id,
        existing as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>
      );

      return success({
        id: updated.id,
        name: updated.name,
        status: updated.status,
        priceBasis: updated.priceBasis,
        billingAccountIds: updated.billingAccountIds,
        isActive: updated.status === 'ACTIVE',
        customer: updated.customer,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      });
    } catch (error) {
      console.error('Failed to update pricing list:', error);
      return serverError('Failed to update pricing list');
    }
  }
);

/**
 * DELETE /api/pricing-lists/[id]
 *
 * Delete a pricing list and its rules.
 */
export const DELETE = withPermissionAndScope(
  { resource: 'customers', action: 'delete' },
  resolveCustomerId,
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id } = context.params;

      // Find existing with rule count
      const existing = await prisma.pricingList.findUnique({
        where: { id },
        include: {
          _count: {
            select: { pricingRules: true },
          },
        },
      });

      if (!existing) {
        return notFound('Pricing list not found');
      }

      // Delete rules first, then pricing list
      await prisma.$transaction([
        prisma.pricingRule.deleteMany({
          where: { pricingListId: id },
        }),
        prisma.pricingList.delete({
          where: { id },
        }),
      ]);

      // Audit log
      await logDelete(
        context,
        'pricing_lists',
        id,
        existing as unknown as Record<string, unknown>
      );

      return success({ deleted: true });
    } catch (error) {
      console.error('Failed to delete pricing list:', error);
      return serverError('Failed to delete pricing list');
    }
  }
);
