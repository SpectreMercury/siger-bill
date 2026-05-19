/**
 * /api/pricing-lists/:id/rules
 *
 * GET  - List rules for a pricing list (default rule first, then explicit rules)
 * POST - Create an explicit rule covering N SKU groups. Those groups are
 *        moved off the default rule in the same transaction.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { withPermissionAndScope } from '@/lib/middleware';
import { logCreate } from '@/lib/audit';
import {
  validateBody,
  createPricingRuleSchema,
  validationError,
  success,
  created,
  serverError,
  notFound,
  badRequest,
} from '@/lib/utils';

async function getCustomerIdFromPricingList(pricingListId: string): Promise<string | null> {
  const pricingList = await prisma.pricingList.findUnique({
    where: { id: pricingListId },
    select: { customerId: true },
  });
  return pricingList?.customerId ?? null;
}

function mapRule(rule: {
  id: string;
  isDefault: boolean;
  ruleType: string;
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
    discountPercent: rule.discountRate ? `${((1 - Number(rule.discountRate)) * 100).toFixed(1)}%` : null,
    unitPrice: rule.unitPrice ? rule.unitPrice.toString() : null,
    tiers: rule.tiers ?? null,
    skuGroups: rule.skuGroups.map((g) => g.skuGroup),
    effectiveStart: rule.effectiveStart,
    effectiveEnd: rule.effectiveEnd,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

export const GET = withPermissionAndScope(
  { resource: 'customers', action: 'read' },
  async (_req, routeParams) => {
    const params = await routeParams?.params;
    const pricingListId = params?.id;
    if (!pricingListId) return null;
    return getCustomerIdFromPricingList(pricingListId);
  },
  async (_request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id: pricingListId } = context.params;

      const pricingList = await prisma.pricingList.findUnique({
        where: { id: pricingListId },
        include: { customer: { select: { id: true, name: true } } },
      });
      if (!pricingList) return notFound('Pricing list');

      const rules = await prisma.pricingRule.findMany({
        where: { pricingListId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        include: {
          skuGroups: {
            include: { skuGroup: { select: { id: true, code: true, name: true } } },
            orderBy: { skuGroup: { code: 'asc' } },
          },
        },
      });

      return success({
        pricingList: { id: pricingList.id, name: pricingList.name, status: pricingList.status },
        customer: pricingList.customer,
        data: rules.map(mapRule),
        pagination: { page: 1, limit: rules.length, total: rules.length, totalPages: 1 },
      });
    } catch (error) {
      console.error('Failed to list pricing rules:', error);
      return serverError('Failed to retrieve pricing rules');
    }
  }
);

export const POST = withPermissionAndScope(
  { resource: 'customers', action: 'update' },
  async (_req, routeParams) => {
    const params = await routeParams?.params;
    const pricingListId = params?.id;
    if (!pricingListId) return null;
    return getCustomerIdFromPricingList(pricingListId);
  },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id: pricingListId } = context.params;

      const pricingList = await prisma.pricingList.findUnique({
        where: { id: pricingListId },
        include: { customer: { select: { id: true, name: true } } },
      });
      if (!pricingList) return notFound('Pricing list');

      const validation = await validateBody(request, createPricingRuleSchema);
      if (!validation.success) return validationError(validation.error);

      const {
        ruleType,
        discountRate,
        unitPrice,
        tiers,
        skuGroupIds,
        effectiveStart,
        effectiveEnd,
      } = validation.data;

      // Date range
      if (effectiveStart && effectiveEnd) {
        if (new Date(effectiveStart) > new Date(effectiveEnd)) {
          return badRequest('Effective start date must be before end date');
        }
      }

      // Validate provided SkuGroup ids exist
      const groups = await prisma.skuGroup.findMany({
        where: { id: { in: skuGroupIds } },
        select: { id: true, code: true },
      });
      if (groups.length !== skuGroupIds.length) {
        const found = new Set(groups.map((g) => g.id));
        const missing = skuGroupIds.filter((id) => !found.has(id));
        return badRequest('Some SKU group IDs are invalid', { missing });
      }

      // Verify every selected group currently belongs to the DEFAULT rule of this list.
      // (Invariant: a group can only ever be in one rule per list, so this is equivalent
      //  to saying "no other explicit rule already covers it".)
      const currentAssignments = await prisma.pricingRuleSkuGroup.findMany({
        where: { pricingListId, skuGroupId: { in: skuGroupIds } },
        include: { pricingRule: { select: { id: true, isDefault: true } } },
      });
      const conflicting = currentAssignments.filter((a) => !a.pricingRule.isDefault);
      if (conflicting.length > 0) {
        return badRequest(
          'Some SKU groups are already covered by an existing rule and must be removed from it first.',
          { conflictingSkuGroupIds: conflicting.map((c) => c.skuGroupId) }
        );
      }

      const defaultRule = await prisma.pricingRule.findFirst({
        where: { pricingListId, isDefault: true },
        select: { id: true },
      });
      if (!defaultRule) {
        return serverError('Pricing list has no default rule (data inconsistency)');
      }

      // Transaction: detach groups from default, create new rule + attach
      const rule = await prisma.$transaction(async (tx) => {
        await tx.pricingRuleSkuGroup.deleteMany({
          where: {
            pricingRuleId: defaultRule.id,
            skuGroupId: { in: skuGroupIds },
          },
        });

        const newRule = await tx.pricingRule.create({
          data: {
            pricingListId,
            isDefault: false,
            ruleType,
            discountRate: discountRate ?? null,
            unitPrice: unitPrice ?? null,
            tiers: tiers ? (tiers as Prisma.InputJsonValue) : Prisma.DbNull,
            effectiveStart: effectiveStart ? new Date(effectiveStart) : null,
            effectiveEnd: effectiveEnd ? new Date(effectiveEnd) : null,
          },
        });

        await tx.pricingRuleSkuGroup.createMany({
          data: skuGroupIds.map((skuGroupId) => ({
            pricingRuleId: newRule.id,
            skuGroupId,
            pricingListId,
          })),
        });

        return tx.pricingRule.findUniqueOrThrow({
          where: { id: newRule.id },
          include: {
            skuGroups: {
              include: { skuGroup: { select: { id: true, code: true, name: true } } },
              orderBy: { skuGroup: { code: 'asc' } },
            },
          },
        });
      });

      await logCreate(context, 'pricing_rules', rule.id, {
        pricingListId,
        pricingListName: pricingList.name,
        customerId: pricingList.customerId,
        ruleType,
        discountRate,
        skuGroupIds,
      });

      return created({
        message: 'Pricing rule created successfully',
        rule: mapRule(rule),
        pricingList: { id: pricingList.id, name: pricingList.name },
      });
    } catch (error) {
      console.error('Failed to create pricing rule:', error);
      return serverError('Failed to create pricing rule');
    }
  }
);
