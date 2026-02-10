/**
 * /api/sku-groups/:id/mappings
 *
 * SKU Group mapping management endpoints.
 * Manages the many-to-many relationship between SKUs and SKU Groups.
 *
 * GET  - List SKUs in this group
 * POST - Add SKUs to this group
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logAuditEvent } from '@/lib/audit';
import { AuditAction } from '@prisma/client';
import {
  validateBody,
  skuGroupMappingSchema,
  paginationSchema,
  validationError,
  success,
  created,
  serverError,
  notFound,
  badRequest,
} from '@/lib/utils';

/**
 * GET /api/sku-groups/:id/mappings
 *
 * List all SKUs mapped to this group.
 * Requires sku_groups:read permission.
 */
export const GET = withPermission(
  { resource: 'sku_groups', action: 'read' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const skuGroupId = context.params.id;
      const { searchParams } = new URL(request.url);

      // Verify group exists
      const skuGroup = await prisma.skuGroup.findUnique({
        where: { id: skuGroupId },
      });

      if (!skuGroup) {
        return notFound('SKU group');
      }

      // Parse pagination
      const pagination = paginationSchema.safeParse({
        page: searchParams.get('page'),
        limit: searchParams.get('limit'),
      });

      const page = pagination.success ? pagination.data.page : 1;
      const limit = pagination.success ? pagination.data.limit : 100;
      const skip = (page - 1) * limit;

      // Get mappings
      const [mappings, total] = await Promise.all([
        prisma.skuGroupMapping.findMany({
          where: { skuGroupId },
          skip,
          take: limit,
          include: {
            sku: true,
          },
          orderBy: { sku: { skuId: 'asc' } },
        }),
        prisma.skuGroupMapping.count({ where: { skuGroupId } }),
      ]);

      // Transform response
      const data = mappings.map((m) => ({
        mappingId: m.id,
        sku: {
          id: m.sku.id,
          skuId: m.sku.skuId,
          skuDescription: m.sku.skuDescription,
          serviceId: m.sku.serviceId,
          serviceDescription: m.sku.serviceDescription,
          unit: m.sku.unit,
        },
        createdAt: m.createdAt,
      }));

      return success({
        skuGroup: {
          id: skuGroup.id,
          code: skuGroup.code,
          name: skuGroup.name,
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
      console.error('Failed to list SKU group mappings:', error);
      return serverError('Failed to retrieve SKU group mappings');
    }
  }
);

/**
 * POST /api/sku-groups/:id/mappings
 *
 * Add SKUs to this group.
 * Requires sku_groups:write permission.
 *
 * Body: { skuIds: ["google-sku-id-1", "google-sku-id-2", ...] }
 *
 * Idempotent: existing mappings are skipped.
 */
export const POST = withPermission(
  { resource: 'sku_groups', action: 'write' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const skuGroupId = context.params.id;

      // Verify group exists
      const skuGroup = await prisma.skuGroup.findUnique({
        where: { id: skuGroupId },
      });

      if (!skuGroup) {
        return notFound('SKU group');
      }

      // Validate request body
      const validation = await validateBody(request, skuGroupMappingSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const { skuIds } = validation.data;

      // Find SKUs by Google SKU IDs
      const skus = await prisma.sku.findMany({
        where: { skuId: { in: skuIds } },
      });

      if (skus.length === 0) {
        return badRequest(
          'No matching SKUs found. Create SKUs first.',
          { requestedSkuIds: skuIds }
        );
      }

      // Check for missing SKUs
      const foundSkuIds = new Set(skus.map((s) => s.skuId));
      const missingSkuIds = skuIds.filter((id) => !foundSkuIds.has(id));

      // Get existing mappings to avoid duplicates
      const existingMappings = await prisma.skuGroupMapping.findMany({
        where: {
          skuGroupId,
          skuId: { in: skus.map((s) => s.id) },
        },
        select: { skuId: true },
      });

      const existingSkuIds = new Set(existingMappings.map((m) => m.skuId));
      const skusToAdd = skus.filter((s) => !existingSkuIds.has(s.id));

      // Create new mappings
      let addedCount = 0;
      if (skusToAdd.length > 0) {
        await prisma.skuGroupMapping.createMany({
          data: skusToAdd.map((sku) => ({
            skuId: sku.id,
            skuGroupId,
          })),
        });
        addedCount = skusToAdd.length;

        // Audit log
        await logAuditEvent(context, {
          action: AuditAction.BIND,
          targetTable: 'sku_group_mappings',
          targetId: skuGroupId,
          afterData: {
            skuGroupCode: skuGroup.code,
            skuIdsAdded: skusToAdd.map((s) => s.skuId),
            count: addedCount,
          },
        });
      }

      return created({
        message: `${addedCount} SKU(s) added to group '${skuGroup.code}'`,
        skuGroup: {
          id: skuGroup.id,
          code: skuGroup.code,
          name: skuGroup.name,
        },
        added: addedCount,
        skipped: existingMappings.length,
        notFound: missingSkuIds,
      });

    } catch (error) {
      console.error('Failed to add SKUs to group:', error);
      return serverError('Failed to add SKUs to group');
    }
  }
);

/**
 * DELETE /api/sku-groups/:id/mappings
 *
 * Remove SKUs from this group.
 * Requires sku_groups:write permission.
 *
 * Body: { skuIds: ["google-sku-id-1", "google-sku-id-2", ...] }
 */
export const DELETE = withPermission(
  { resource: 'sku_groups', action: 'write' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const skuGroupId = context.params.id;

      // Verify group exists
      const skuGroup = await prisma.skuGroup.findUnique({
        where: { id: skuGroupId },
      });

      if (!skuGroup) {
        return notFound('SKU group');
      }

      // Validate request body
      const validation = await validateBody(request, skuGroupMappingSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const { skuIds } = validation.data;

      // Find SKUs by Google SKU IDs
      const skus = await prisma.sku.findMany({
        where: { skuId: { in: skuIds } },
        select: { id: true, skuId: true },
      });

      if (skus.length === 0) {
        return badRequest('No matching SKUs found');
      }

      // Delete mappings
      const result = await prisma.skuGroupMapping.deleteMany({
        where: {
          skuGroupId,
          skuId: { in: skus.map((s) => s.id) },
        },
      });

      // Audit log
      if (result.count > 0) {
        await logAuditEvent(context, {
          action: AuditAction.UNBIND,
          targetTable: 'sku_group_mappings',
          targetId: skuGroupId,
          afterData: {
            skuGroupCode: skuGroup.code,
            skuIdsRemoved: skus.map((s) => s.skuId),
            count: result.count,
          },
        });
      }

      return success({
        message: `${result.count} SKU(s) removed from group '${skuGroup.code}'`,
        removed: result.count,
      });

    } catch (error) {
      console.error('Failed to remove SKUs from group:', error);
      return serverError('Failed to remove SKUs from group');
    }
  }
);
