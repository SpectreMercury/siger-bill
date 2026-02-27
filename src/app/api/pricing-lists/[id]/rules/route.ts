/**
 * /api/pricing-lists/:id/rules
 *
 * Pricing rule management endpoints.
 * Rules define how to price SKU groups for a customer.
 *
 * GET  - List rules for a pricing list
 * POST - Create new rule for a pricing list
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { withPermissionAndScope } from '@/lib/middleware';
import { logCreate } from '@/lib/audit';
import {
  validateBody,
  createPricingRuleSchema,
  paginationSchema,
  validationError,
  success,
  created,
  serverError,
  notFound,
  badRequest,
} from '@/lib/utils';

/**
 * Helper to get customerId from pricing list
 */
async function getCustomerIdFromPricingList(pricingListId: string): Promise<string | null> {
  const pricingList = await prisma.pricingList.findUnique({
    where: { id: pricingListId },
    select: { customerId: true },
  });
  return pricingList?.customerId ?? null;
}

/**
 * GET /api/pricing-lists/:id/rules
 *
 * List rules for a pricing list.
 * Requires customers:read permission + customer scope.
 */
export const GET = withPermissionAndScope(
  { resource: 'customers', action: 'read' },
  async (_req, routeParams) => {
    const params = await routeParams?.params;
    const pricingListId = params?.id;
    if (!pricingListId) return null;
    return getCustomerIdFromPricingList(pricingListId);
  },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id: pricingListId } = context.params;
      const { searchParams } = new URL(request.url);

      // Get pricing list with customer info
      const pricingList = await prisma.pricingList.findUnique({
        where: { id: pricingListId },
        include: {
          customer: {
            select: { id: true, name: true },
          },
        },
      });

      if (!pricingList) {
        return notFound('Pricing list');
      }

      // Parse pagination
      const pagination = paginationSchema.safeParse({
        page: searchParams.get('page'),
        limit: searchParams.get('limit'),
      });

      const page = pagination.success ? pagination.data.page : 1;
      const limit = pagination.success ? pagination.data.limit : 50;
      const skip = (page - 1) * limit;

      // Get rules
      const [rules, total] = await Promise.all([
        prisma.pricingRule.findMany({
          where: { pricingListId },
          skip,
          take: limit,
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
          include: {
            skuGroup: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        }),
        prisma.pricingRule.count({ where: { pricingListId } }),
      ]);

      // Transform response
      const data = rules.map((rule) => ({
        id: rule.id,
        ruleType: rule.ruleType,
        discountRate: rule.discountRate ? rule.discountRate.toString() : null,
        discountPercent: rule.discountRate ? `${(1 - Number(rule.discountRate)) * 100}%` : null,
        unitPrice: rule.unitPrice ? rule.unitPrice.toString() : null,
        tiers: rule.tiers ?? null,
        skuGroup: rule.skuGroup,
        effectiveStart: rule.effectiveStart,
        effectiveEnd: rule.effectiveEnd,
        priority: rule.priority,
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
      }));

      return success({
        pricingList: {
          id: pricingList.id,
          name: pricingList.name,
          status: pricingList.status,
        },
        customer: pricingList.customer,
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });

    } catch (error) {
      console.error('Failed to list pricing rules:', error);
      return serverError('Failed to retrieve pricing rules');
    }
  }
);

/**
 * POST /api/pricing-lists/:id/rules
 *
 * Create a new pricing rule.
 * Requires customers:update permission + customer scope.
 *
 * Body:
 * - ruleType: "LIST_DISCOUNT" (default)
 * - discountRate: decimal (e.g., 0.90 = 90% of list price = 10% discount)
 * - skuGroupId: UUID or null (null = applies to all SKUs)
 * - effectiveStart: "YYYY-MM-DD" or null
 * - effectiveEnd: "YYYY-MM-DD" or null
 * - priority: integer (lower = higher priority)
 */
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

      // Get pricing list with customer info
      const pricingList = await prisma.pricingList.findUnique({
        where: { id: pricingListId },
        include: {
          customer: {
            select: { id: true, name: true },
          },
        },
      });

      if (!pricingList) {
        return notFound('Pricing list');
      }

      // Validate request body
      const validation = await validateBody(request, createPricingRuleSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const {
        ruleType,
        discountRate,
        unitPrice,
        tiers,
        skuGroupId,
        effectiveStart,
        effectiveEnd,
        priority,
      } = validation.data;

      // Validate SKU group if provided
      if (skuGroupId) {
        const skuGroup = await prisma.skuGroup.findUnique({
          where: { id: skuGroupId },
        });
        if (!skuGroup) {
          return badRequest(
            'Invalid SKU group ID',
            { skuGroupId }
          );
        }
      }

      // Validate date range
      if (effectiveStart && effectiveEnd) {
        const start = new Date(effectiveStart);
        const end = new Date(effectiveEnd);
        if (start > end) {
          return badRequest('Effective start date must be before end date');
        }
      }

      // Create pricing rule
      const rule = await prisma.pricingRule.create({
        data: {
          pricingListId,
          ruleType,
          discountRate: discountRate ?? null,
          unitPrice: unitPrice ?? null,
          tiers: tiers ? (tiers as Prisma.InputJsonValue) : Prisma.DbNull,
          skuGroupId: skuGroupId ?? null,
          effectiveStart: effectiveStart ? new Date(effectiveStart) : null,
          effectiveEnd: effectiveEnd ? new Date(effectiveEnd) : null,
          priority,
        },
        include: {
          skuGroup: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      });

      // Audit log
      await logCreate(context, 'pricing_rules', rule.id, {
        pricingListId,
        pricingListName: pricingList.name,
        customerId: pricingList.customerId,
        customerName: pricingList.customer.name,
        ruleType,
        discountRate,
        skuGroupId,
        priority,
      });

      return created({
        message: 'Pricing rule created successfully',
        rule: {
          id: rule.id,
          ruleType: rule.ruleType,
          discountRate: rule.discountRate ? rule.discountRate.toString() : null,
          discountPercent: rule.discountRate ? `${(1 - Number(rule.discountRate)) * 100}%` : null,
          unitPrice: rule.unitPrice ? rule.unitPrice.toString() : null,
          tiers: rule.tiers ?? null,
          skuGroup: rule.skuGroup,
          effectiveStart: rule.effectiveStart,
          effectiveEnd: rule.effectiveEnd,
          priority: rule.priority,
          createdAt: rule.createdAt,
        },
        pricingList: {
          id: pricingList.id,
          name: pricingList.name,
        },
      });

    } catch (error) {
      console.error('Failed to create pricing rule:', error);
      return serverError('Failed to create pricing rule');
    }
  }
);
