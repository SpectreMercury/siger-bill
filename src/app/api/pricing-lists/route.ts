/**
 * /api/pricing-lists
 *
 * Pricing list management endpoints.
 *
 * GET  - List all pricing lists
 * POST - Create a new pricing list (also creates a default rule covering all SKU groups)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logCreate } from '@/lib/audit';
import { PricingListStatus, Prisma } from '@prisma/client';
import {
  success,
  created,
  serverError,
  validationError,
  notFound,
  createPricingListSchema,
} from '@/lib/utils';

/**
 * GET /api/pricing-lists
 *
 * List all pricing lists with optional filtering.
 */
export const GET = withPermission(
  { resource: 'customers', action: 'list' },
  async (request: NextRequest): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);

      const page = parseInt(searchParams.get('page') || '1');
      const limit = parseInt(searchParams.get('limit') || '20');
      const skip = (page - 1) * limit;

      const customerId = searchParams.get('customerId');
      const status = searchParams.get('status') as PricingListStatus | null;

      const where: Prisma.PricingListWhereInput = {};
      if (customerId) where.customerId = customerId;
      if (status && ['ACTIVE', 'INACTIVE'].includes(status)) where.status = status;

      const [pricingLists, total] = await Promise.all([
        prisma.pricingList.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            customer: { select: { id: true, name: true, externalId: true } },
            _count: { select: { pricingRules: true } },
          },
        }),
        prisma.pricingList.count({ where }),
      ]);

      const data = pricingLists.map((pl) => ({
        id: pl.id,
        name: pl.name,
        status: pl.status,
        isActive: pl.status === 'ACTIVE',
        customer: pl.customer,
        ruleCount: pl._count.pricingRules,
        createdAt: pl.createdAt,
        updatedAt: pl.updatedAt,
      }));

      return success({
        data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (error) {
      console.error('Failed to list pricing lists:', error);
      return serverError('Failed to retrieve pricing lists');
    }
  }
);

/**
 * POST /api/pricing-lists
 *
 * Create a new pricing list. Also creates the list's default PricingRule
 * (isDefault=true) covering every SkuGroup, with discountRate derived from
 * `defaultDiscountPercent` (e.g. 10 → 0.9 = 10% off list).
 *
 * Runs in a single transaction so the list is never observed without its
 * default rule.
 */
export const POST = withPermission(
  { resource: 'customers', action: 'update' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const body = await request.json();
      const validation = createPricingListSchema.safeParse(body);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const data = validation.data;

      const customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
      if (!customer) return notFound('Customer');

      const allGroups = await prisma.skuGroup.findMany({ select: { id: true } });
      const discountRate = (1 - data.defaultDiscountPercent / 100).toFixed(4); // 4 decimal places to match @db.Decimal(5,4)

      const pricingList = await prisma.$transaction(async (tx) => {
        const list = await tx.pricingList.create({
          data: {
            customerId: data.customerId,
            name: data.name,
            status: data.status,
          },
          include: { customer: { select: { id: true, name: true } } },
        });

        const defaultRule = await tx.pricingRule.create({
          data: {
            pricingListId: list.id,
            isDefault: true,
            ruleType: 'LIST_DISCOUNT',
            discountRate,
          },
        });

        if (allGroups.length > 0) {
          await tx.pricingRuleSkuGroup.createMany({
            data: allGroups.map((g) => ({
              pricingRuleId: defaultRule.id,
              skuGroupId: g.id,
              pricingListId: list.id,
            })),
          });
        }

        return list;
      });

      await logCreate(context, 'pricing_lists', pricingList.id, {
        customerId: pricingList.customerId,
        name: pricingList.name,
        defaultDiscountPercent: data.defaultDiscountPercent,
        defaultGroupCount: allGroups.length,
      });

      return created({
        id: pricingList.id,
        name: pricingList.name,
        status: pricingList.status,
        isActive: pricingList.status === 'ACTIVE',
        customer: pricingList.customer,
        defaultDiscountPercent: data.defaultDiscountPercent,
        createdAt: pricingList.createdAt,
      });
    } catch (error) {
      console.error('Failed to create pricing list:', error);
      return serverError('Failed to create pricing list');
    }
  }
);
