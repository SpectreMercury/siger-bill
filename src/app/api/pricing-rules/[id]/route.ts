/**
 * /api/pricing-rules/[id]
 *
 * Single pricing rule operations.
 *
 * DELETE - Delete a pricing rule
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logDelete } from '@/lib/audit';
import {
  success,
  notFound,
  serverError,
} from '@/lib/utils';

/**
 * DELETE /api/pricing-rules/[id]
 *
 * Delete a pricing rule.
 */
export const DELETE = withPermission(
  { resource: 'customers', action: 'update' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id } = context.params;

      // Find existing rule
      const existing = await prisma.pricingRule.findUnique({
        where: { id },
        include: {
          pricingList: {
            select: {
              id: true,
              name: true,
              customerId: true,
            },
          },
        },
      });

      if (!existing) {
        return notFound('Pricing rule not found');
      }

      // Delete rule
      await prisma.pricingRule.delete({
        where: { id },
      });

      // Audit log
      await logDelete(
        context,
        'pricing_rules',
        id,
        existing as unknown as Record<string, unknown>
      );

      return success({ deleted: true });
    } catch (error) {
      console.error('Failed to delete pricing rule:', error);
      return serverError('Failed to delete pricing rule');
    }
  }
);
