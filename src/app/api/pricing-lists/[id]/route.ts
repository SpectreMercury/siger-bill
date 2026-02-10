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
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logUpdate, logDelete } from '@/lib/audit';
import { PricingListStatus } from '@prisma/client';
import {
  success,
  notFound,
  serverError,
  conflict,
} from '@/lib/utils';

/**
 * GET /api/pricing-lists/[id]
 *
 * Get pricing list details with rules.
 */
export const GET = withPermission(
  { resource: 'customers', action: 'read' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id } = context.params;

      const pricingList = await prisma.pricingList.findUnique({
        where: { id },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              externalId: true,
            },
          },
          pricingRules: {
            include: {
              skuGroup: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
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
        isActive: pricingList.status === 'ACTIVE',
        customer: pricingList.customer,
        rules: pricingList.pricingRules.map((rule) => ({
          id: rule.id,
          skuGroup: rule.skuGroup,
          ruleType: rule.ruleType,
          discountRate: rule.discountRate.toString(),
          discountPercent: ((1 - Number(rule.discountRate)) * 100).toFixed(1),
          effectiveStart: rule.effectiveStart,
          effectiveEnd: rule.effectiveEnd,
          priority: rule.priority,
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
export const PUT = withPermission(
  { resource: 'customers', action: 'update' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id } = context.params;
      const body = await request.json();

      // Find existing
      const existing = await prisma.pricingList.findUnique({
        where: { id },
      });

      if (!existing) {
        return notFound('Pricing list not found');
      }

      // Build update data
      const updateData: Record<string, unknown> = {};
      if (body.name !== undefined) {
        updateData.name = body.name;
      }
      if (body.status && ['ACTIVE', 'INACTIVE'].includes(body.status)) {
        updateData.status = body.status as PricingListStatus;
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
export const DELETE = withPermission(
  { resource: 'customers', action: 'delete' },
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
