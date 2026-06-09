/**
 * /api/pricing-rules/[id]
 *
 * PUT    - Update pricing rule values without changing SKU group ownership.
 * DELETE - Delete an explicit pricing rule. The SkuGroups it covered are
 *          re-attached to the list's default rule in the same transaction.
 *          Deleting the default rule is forbidden.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Prisma, PricingRuleType } from '@prisma/client';
import { withPermission } from '@/lib/middleware';
import { logDelete, logUpdate } from '@/lib/audit';
import {
  success,
  notFound,
  serverError,
  badRequest,
  validationError,
  validateBody,
  updatePricingRuleSchema,
} from '@/lib/utils';

function mapRule(rule: {
  id: string;
  isDefault: boolean;
  ruleType: PricingRuleType;
  discountRate: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
  tiers: Prisma.JsonValue | null;
  effectiveStart: Date | null;
  effectiveEnd: Date | null;
  createdAt: Date;
  updatedAt: Date;
  skuGroups: Array<{ skuGroup: { id: string; code: string; name: string } }>;
}) {
  return {
    id: rule.id,
    isDefault: rule.isDefault,
    ruleType: rule.ruleType,
    discountRate: rule.discountRate ? rule.discountRate.toString() : null,
    discountPercent: rule.discountRate ? ((1 - Number(rule.discountRate)) * 100).toFixed(1) : null,
    unitPrice: rule.unitPrice ? rule.unitPrice.toString() : null,
    tiers: rule.tiers ?? null,
    skuGroups: rule.skuGroups.map((g) => g.skuGroup),
    effectiveStart: rule.effectiveStart,
    effectiveEnd: rule.effectiveEnd,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

export const PUT = withPermission(
  { resource: 'customers', action: 'update' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id } = context.params;

      const validation = await validateBody(request, updatePricingRuleSchema);
      if (!validation.success) return validationError(validation.error);

      const existing = await prisma.pricingRule.findUnique({
        where: { id },
        include: {
          pricingList: { select: { id: true, name: true, customerId: true } },
          skuGroups: {
            include: { skuGroup: { select: { id: true, code: true, name: true } } },
            orderBy: { skuGroup: { code: 'asc' } },
          },
        },
      });
      if (!existing) return notFound('Pricing rule');

      const data = validation.data;
      const ruleType = data.ruleType ?? existing.ruleType;
      const discountRate = data.discountRate ?? (existing.discountRate ? Number(existing.discountRate) : null);
      const unitPrice = data.unitPrice ?? (existing.unitPrice ? Number(existing.unitPrice) : null);
      const tiers = data.tiers ?? (existing.tiers as Prisma.JsonValue | null);
      const effectiveStart = data.effectiveStart === undefined
        ? existing.effectiveStart
        : data.effectiveStart
          ? new Date(data.effectiveStart)
          : null;
      const effectiveEnd = data.effectiveEnd === undefined
        ? existing.effectiveEnd
        : data.effectiveEnd
          ? new Date(data.effectiveEnd)
          : null;

      if (effectiveStart && effectiveEnd && effectiveStart > effectiveEnd) {
        return badRequest('Effective start date must be before end date');
      }
      if (ruleType === 'LIST_DISCOUNT' && discountRate == null) {
        return badRequest('discountRate is required for LIST_DISCOUNT rules');
      }
      if (ruleType === 'UNIT_PRICE' && unitPrice == null) {
        return badRequest('unitPrice is required for UNIT_PRICE rules');
      }
      if (ruleType === 'TIERED' && (!Array.isArray(tiers) || tiers.length === 0)) {
        return badRequest('tiers is required for TIERED rules');
      }

      const updateData: Prisma.PricingRuleUpdateInput = {
        ruleType,
        effectiveStart,
        effectiveEnd,
      };

      if (ruleType === 'LIST_DISCOUNT') {
        updateData.discountRate = discountRate;
        updateData.unitPrice = null;
        updateData.tiers = Prisma.DbNull;
      } else if (ruleType === 'UNIT_PRICE') {
        updateData.discountRate = null;
        updateData.unitPrice = unitPrice;
        updateData.tiers = Prisma.DbNull;
      } else {
        updateData.discountRate = null;
        updateData.unitPrice = null;
        updateData.tiers = tiers as Prisma.InputJsonValue;
      }

      const updated = await prisma.pricingRule.update({
        where: { id },
        data: updateData,
        include: {
          skuGroups: {
            include: { skuGroup: { select: { id: true, code: true, name: true } } },
            orderBy: { skuGroup: { code: 'asc' } },
          },
        },
      });

      await logUpdate(
        context,
        'pricing_rules',
        id,
        mapRule(existing),
        mapRule(updated)
      );

      return success({
        message: 'Pricing rule updated successfully',
        rule: mapRule(updated),
      });
    } catch (error) {
      console.error('Failed to update pricing rule:', error);
      return serverError('Failed to update pricing rule');
    }
  }
);

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
