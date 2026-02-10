/**
 * /api/customers/:id/pricing-lists
 *
 * Customer pricing list management endpoints.
 * Each customer can have multiple pricing lists (only one ACTIVE at a time recommended).
 *
 * GET  - List pricing lists for customer
 * POST - Create new pricing list for customer
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermissionAndScope } from '@/lib/middleware';
import { logCreate } from '@/lib/audit';
import {
  validateBody,
  createPricingListSchema,
  paginationSchema,
  validationError,
  success,
  created,
  serverError,
  notFound,
} from '@/lib/utils';

/**
 * GET /api/customers/:id/pricing-lists
 *
 * List pricing lists for a customer.
 * Requires pricing:read permission + customer scope.
 */
export const GET = withPermissionAndScope(
  { resource: 'pricing', action: 'read' },
  (_req, routeParams) => routeParams?.params?.id ?? null,
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const customerId = context.params.id;
      const { searchParams } = new URL(request.url);

      // Verify customer exists
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, name: true },
      });

      if (!customer) {
        return notFound('Customer');
      }

      // Parse pagination
      const pagination = paginationSchema.safeParse({
        page: searchParams.get('page'),
        limit: searchParams.get('limit'),
      });

      const page = pagination.success ? pagination.data.page : 1;
      const limit = pagination.success ? pagination.data.limit : 20;
      const skip = (page - 1) * limit;

      // Optional status filter
      const status = searchParams.get('status');
      const where: Record<string, unknown> = { customerId };
      if (status === 'ACTIVE' || status === 'INACTIVE') {
        where.status = status;
      }

      // Get pricing lists
      const [pricingLists, total] = await Promise.all([
        prisma.pricingList.findMany({
          where,
          skip,
          take: limit,
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
          include: {
            _count: {
              select: { pricingRules: true },
            },
          },
        }),
        prisma.pricingList.count({ where }),
      ]);

      // Transform response
      const data = pricingLists.map((pl) => ({
        id: pl.id,
        name: pl.name,
        status: pl.status,
        ruleCount: pl._count.pricingRules,
        createdAt: pl.createdAt,
        updatedAt: pl.updatedAt,
      }));

      return success({
        customer: {
          id: customer.id,
          name: customer.name,
        },
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
 * POST /api/customers/:id/pricing-lists
 *
 * Create a new pricing list for a customer.
 * Requires pricing:write permission + customer scope.
 */
export const POST = withPermissionAndScope(
  { resource: 'pricing', action: 'write' },
  (_req, routeParams) => routeParams?.params?.id ?? null,
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const customerId = context.params.id;

      // Verify customer exists
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, name: true },
      });

      if (!customer) {
        return notFound('Customer');
      }

      // Validate request body
      const validation = await validateBody(request, createPricingListSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const { name, status } = validation.data;

      // Create pricing list
      const pricingList = await prisma.pricingList.create({
        data: {
          customerId,
          name,
          status,
        },
      });

      // Audit log
      await logCreate(context, 'pricing_lists', pricingList.id, {
        customerId,
        customerName: customer.name,
        name,
        status,
      });

      return created({
        message: 'Pricing list created successfully',
        pricingList: {
          id: pricingList.id,
          name: pricingList.name,
          status: pricingList.status,
          createdAt: pricingList.createdAt,
        },
        customer: {
          id: customer.id,
          name: customer.name,
        },
      });

    } catch (error) {
      console.error('Failed to create pricing list:', error);
      return serverError('Failed to create pricing list');
    }
  }
);
