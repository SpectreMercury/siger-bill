/**
 * /api/pricing-lists
 *
 * Pricing list management endpoints.
 *
 * GET  - List all pricing lists
 * POST - Create a new pricing list
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
} from '@/lib/utils';
import { z } from 'zod';

const createPricingListSchema = z.object({
  customerId: z.string().uuid(),
  name: z.string().min(1).max(255),
});

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

      // Parse pagination
      const page = parseInt(searchParams.get('page') || '1');
      const limit = parseInt(searchParams.get('limit') || '20');
      const skip = (page - 1) * limit;

      // Filters
      const customerId = searchParams.get('customerId');
      const status = searchParams.get('status') as PricingListStatus | null;

      const where: Prisma.PricingListWhereInput = {};
      if (customerId) {
        where.customerId = customerId;
      }
      if (status && ['ACTIVE', 'INACTIVE'].includes(status)) {
        where.status = status;
      }

      // Execute queries in parallel
      const [pricingLists, total] = await Promise.all([
        prisma.pricingList.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            customer: {
              select: {
                id: true,
                name: true,
                externalId: true,
              },
            },
            _count: {
              select: { pricingRules: true },
            },
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
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
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
 * Create a new pricing list.
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

      // Verify customer exists
      const customer = await prisma.customer.findUnique({
        where: { id: data.customerId },
      });

      if (!customer) {
        return notFound('Customer not found');
      }

      // Create pricing list
      const pricingList = await prisma.pricingList.create({
        data: {
          customerId: data.customerId,
          name: data.name,
          status: PricingListStatus.ACTIVE,
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Audit log
      await logCreate(
        context,
        'pricing_lists',
        pricingList.id,
        pricingList as unknown as Record<string, unknown>
      );

      return created({
        id: pricingList.id,
        name: pricingList.name,
        status: pricingList.status,
        isActive: pricingList.status === 'ACTIVE',
        customer: pricingList.customer,
        createdAt: pricingList.createdAt,
      });
    } catch (error) {
      console.error('Failed to create pricing list:', error);
      return serverError('Failed to create pricing list');
    }
  }
);
