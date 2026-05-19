/**
 * /api/pricing-rules/[id]
 *
 * DELETE - Delete an explicit pricing rule. The SkuGroups it covered are
 *          re-attached to the list's default rule in the same transaction.
 *          Deleting the default rule is forbidden.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logDelete } from '@/lib/audit';
import { success, notFound, serverError, badRequest } from '@/lib/utils';

export const DELETE = withPermission(
  { resource: 'customers', action: 'update' },
  async (_request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id } = context.params;

      const existing = await prisma.pricingRule.findUnique({
        where: { id },
        include: {
          pricingList: { select: { id: true, name: true, customerId: true } },
          skuGroups: { select: { skuGroupId: true } },
        },
      });
      if (!existing) return notFound('Pricing rule');

      if (existing.isDefault) {
        return badRequest('The default rule cannot be deleted.');
      }

      const defaultRule = await prisma.pricingRule.findFirst({
        where: { pricingListId: existing.pricingListId, isDefault: true },
        select: { id: true },
      });
      if (!defaultRule) {
        return serverError('Pricing list has no default rule (data inconsistency)');
      }

      const groupIds = existing.skuGroups.map((g) => g.skuGroupId);

      await prisma.$transaction(async (tx) => {
        // Cascade on the rule will delete its join rows; we then re-attach to default.
        await tx.pricingRule.delete({ where: { id } });
        if (groupIds.length > 0) {
          await tx.pricingRuleSkuGroup.createMany({
            data: groupIds.map((skuGroupId) => ({
              pricingRuleId: defaultRule.id,
              skuGroupId,
              pricingListId: existing.pricingListId,
            })),
            skipDuplicates: true, // belt-and-braces
          });
        }
      });

      await logDelete(context, 'pricing_rules', id, {
        pricingListId: existing.pricingListId,
        ruleType: existing.ruleType,
        skuGroupsReattachedToDefault: groupIds,
      });

      return success({ deleted: true, restoredToDefault: groupIds.length });
    } catch (error) {
      console.error('Failed to delete pricing rule:', error);
      return serverError('Failed to delete pricing rule');
    }
  }
);
