/**
 * /api/skus
 *
 * SKU master management endpoints.
 * SKUs are Google Cloud billing SKU definitions.
 *
 * GET  - List all SKUs (with pagination and search)
 * POST - Create new SKU(s)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logCreate } from '@/lib/audit';
import {
  validateBody,
  createSkuSchema,
  createSkuBulkSchema,
  paginationSchema,
  validationError,
  success,
  created,
  serverError,
  conflict,
} from '@/lib/utils';

/**
 * GET /api/skus
 *
 * List all SKUs with pagination and optional filtering.
 * Requires skus:read permission.
 */
export const GET = withPermission(
  { resource: 'skus', action: 'read' },
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

      // Optional filters
      const search = searchParams.get('search');
      const serviceId = searchParams.get('serviceId');
      const resourceFamily = searchParams.get('resourceFamily');
      const resourceGroup = searchParams.get('resourceGroup');
      const usageType = searchParams.get('usageType');

      // Build where clause
      const where: Record<string, unknown> = {};

      if (serviceId) {
        where.serviceId = serviceId;
      }

      if (resourceFamily) {
        where.resourceFamily = resourceFamily;
      }

      if (resourceGroup) {
        where.resourceGroup = resourceGroup;
      }

      if (usageType) {
        where.usageType = usageType;
      }

      if (search) {
        where.OR = [
          { skuId: { contains: search, mode: 'insensitive' } },
          { skuDescription: { contains: search, mode: 'insensitive' } },
          { serviceDescription: { contains: search, mode: 'insensitive' } },
        ];
      }

      // Execute queries in parallel
      const [skus, total] = await Promise.all([
        prisma.sku.findMany({
          where,
          skip,
          take: limit,
          orderBy: [{ serviceId: 'asc' }, { skuId: 'asc' }],
          include: {
            skuGroupMappings: {
              include: {
                skuGroup: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                  },
                },
              },
            },
          },
        }),
        prisma.sku.count({ where }),
      ]);

      // Transform response
      const data = skus.map((sku) => ({
        id: sku.id,
        skuId: sku.skuId,
        skuDescription: sku.skuDescription,
        serviceId: sku.serviceId,
        serviceDescription: sku.serviceDescription,
        unit: sku.unit,
        resourceFamily: sku.resourceFamily,
        resourceGroup: sku.resourceGroup,
        usageType: sku.usageType,
        skuGroups: sku.skuGroupMappings.map((m) => m.skuGroup),
        createdAt: sku.createdAt,
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
      console.error('Failed to list SKUs:', error);
      return serverError('Failed to retrieve SKUs');
    }
  }
);

/**
 * POST /api/skus
 *
 * Create new SKU(s).
 * Requires skus:write permission.
 *
 * Supports both single SKU and bulk creation:
 * - Single: { skuId, skuDescription, serviceId, serviceDescription, unit? }
 * - Bulk: { skus: [{ skuId, ... }, ...] }
 */
export const POST = withPermission(
  { resource: 'skus', action: 'write' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      // Try parsing as bulk first
      const bodyText = await request.text();
      const body = JSON.parse(bodyText);

      let skusToCreate: Array<{
        skuId: string;
        skuDescription: string;
        serviceId: string;
        serviceDescription: string;
        unit?: string;
        resourceFamily?: string | null;
        resourceGroup?: string | null;
        usageType?: string | null;
      }>;

      // Determine if bulk or single
      if (body.skus && Array.isArray(body.skus)) {
        // Bulk creation
        const validation = createSkuBulkSchema.safeParse(body);
        if (!validation.success) {
          return validationError(validation.error);
        }
        skusToCreate = validation.data.skus;
      } else {
        // Single creation
        const validation = createSkuSchema.safeParse(body);
        if (!validation.success) {
          return validationError(validation.error);
        }
        skusToCreate = [validation.data];
      }

      // Check for duplicates
      const existingSkuIds = skusToCreate.map((s) => s.skuId);
      const existingSkus = await prisma.sku.findMany({
        where: { skuId: { in: existingSkuIds } },
        select: { skuId: true },
      });

      if (existingSkus.length > 0) {
        const duplicates = existingSkus.map((s) => s.skuId);
        return conflict(
          `SKU(s) already exist: ${duplicates.join(', ')}`,
          { duplicates }
        );
      }

      // Create SKUs
      const createdSkus = await prisma.$transaction(async (tx) => {
        const results = [];
        for (const sku of skusToCreate) {
          const created = await tx.sku.create({
            data: {
              skuId: sku.skuId,
              skuDescription: sku.skuDescription,
              serviceId: sku.serviceId,
              serviceDescription: sku.serviceDescription,
              unit: sku.unit ?? null,
              resourceFamily: sku.resourceFamily ?? null,
              resourceGroup: sku.resourceGroup ?? null,
              usageType: sku.usageType ?? null,
            },
          });
          results.push(created);
        }
        return results;
      });

      // Audit log
      for (const sku of createdSkus) {
        await logCreate(context, 'skus', sku.id, {
          skuId: sku.skuId,
          serviceId: sku.serviceId,
        });
      }

      if (createdSkus.length === 1) {
        return created({
          message: 'SKU created successfully',
          sku: createdSkus[0],
        });
      } else {
        return created({
          message: `${createdSkus.length} SKUs created successfully`,
          skus: createdSkus,
          count: createdSkus.length,
        });
      }

    } catch (error) {
      console.error('Failed to create SKU(s):', error);
      return serverError('Failed to create SKU(s)');
    }
  }
);
