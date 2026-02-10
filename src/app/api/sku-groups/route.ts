/**
 * /api/sku-groups
 *
 * SKU Group management endpoints.
 * SKU Groups are logical groupings of SKUs for pricing purposes.
 *
 * GET  - List all SKU groups
 * POST - Create new SKU group
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logCreate } from '@/lib/audit';
import {
  validateBody,
  createSkuGroupSchema,
  paginationSchema,
  validationError,
  success,
  created,
  serverError,
  conflict,
} from '@/lib/utils';

/**
 * GET /api/sku-groups
 *
 * List all SKU groups with pagination.
 * Requires sku_groups:read permission.
 */
export const GET = withPermission(
  { resource: 'sku_groups', action: 'read' },
  async (request: NextRequest): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);

      // Parse pagination
      const pagination = paginationSchema.safeParse({
        page: searchParams.get('page'),
        limit: searchParams.get('limit'),
      });

      const page = pagination.success ? pagination.data.page : 1;
      const limit = pagination.success ? pagination.data.limit : 50;
      const skip = (page - 1) * limit;

      // Optional search
      const search = searchParams.get('search');
      const where: Record<string, unknown> = {};

      if (search) {
        where.OR = [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ];
      }

      // Execute queries in parallel
      const [skuGroups, total] = await Promise.all([
        prisma.skuGroup.findMany({
          where,
          skip,
          take: limit,
          orderBy: { code: 'asc' },
          include: {
            _count: {
              select: {
                skuGroupMappings: true,
                pricingRules: true,
              },
            },
          },
        }),
        prisma.skuGroup.count({ where }),
      ]);

      // Transform response
      const data = skuGroups.map((group) => ({
        id: group.id,
        code: group.code,
        name: group.name,
        description: group.description,
        skuCount: group._count.skuGroupMappings,
        ruleCount: group._count.pricingRules,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
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
      console.error('Failed to list SKU groups:', error);
      return serverError('Failed to retrieve SKU groups');
    }
  }
);

/**
 * POST /api/sku-groups
 *
 * Create a new SKU group.
 * Requires sku_groups:write permission.
 */
export const POST = withPermission(
  { resource: 'sku_groups', action: 'write' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      // Validate request body
      const validation = await validateBody(request, createSkuGroupSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const { code, name, description } = validation.data;

      // Check for duplicate code
      const existing = await prisma.skuGroup.findUnique({
        where: { code },
      });

      if (existing) {
        return conflict(
          `SKU group with code '${code}' already exists`,
          { existingId: existing.id }
        );
      }

      // Create SKU group
      const skuGroup = await prisma.skuGroup.create({
        data: {
          code,
          name,
          description: description ?? null,
        },
      });

      // Audit log
      await logCreate(context, 'sku_groups', skuGroup.id, {
        code,
        name,
      });

      return created({
        message: 'SKU group created successfully',
        skuGroup: {
          id: skuGroup.id,
          code: skuGroup.code,
          name: skuGroup.name,
          description: skuGroup.description,
          createdAt: skuGroup.createdAt,
        },
      });

    } catch (error) {
      console.error('Failed to create SKU group:', error);
      return serverError('Failed to create SKU group');
    }
  }
);
