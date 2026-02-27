/**
 * /api/skus/categories
 *
 * Returns the GCP SKU category tree derived from the SKU master data.
 * Used by the Add SKU modal to enable hierarchical browsing.
 *
 * The tree mirrors the Cloud Billing API taxonomy:
 *   Service → Resource Family → Resource Group → Usage Type
 *
 * GET - Returns the full category tree
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { success, serverError } from '@/lib/utils';

export interface SkuCategoryTree {
  services: ServiceNode[];
}

export interface ServiceNode {
  serviceId: string;
  serviceDescription: string;
  skuCount: number;
  families: FamilyNode[];
}

export interface FamilyNode {
  resourceFamily: string;
  skuCount: number;
  groups: GroupNode[];
}

export interface GroupNode {
  resourceGroup: string;
  skuCount: number;
  usageTypes: UsageTypeNode[];
}

export interface UsageTypeNode {
  usageType: string;
  skuCount: number;
}

/**
 * GET /api/skus/categories
 *
 * Returns the category tree built from distinct values in the skus table.
 * SKUs with null category fields are grouped under "Other".
 */
export const GET = withPermission(
  { resource: 'skus', action: 'read' },
  async (): Promise<NextResponse> => {
    try {
      // Fetch all distinct category combinations with counts
      const rows = await prisma.sku.groupBy({
        by: ['serviceId', 'serviceDescription', 'resourceFamily', 'resourceGroup', 'usageType'],
        _count: { id: true },
        orderBy: [
          { serviceDescription: 'asc' },
          { resourceFamily: 'asc' },
          { resourceGroup: 'asc' },
          { usageType: 'asc' },
        ],
      });

      // Build nested tree structure
      const serviceMap = new Map<string, ServiceNode>();

      for (const row of rows) {
        const serviceKey = row.serviceId;
        const family = row.resourceFamily ?? 'Other';
        const group = row.resourceGroup ?? 'Other';
        const usageType = row.usageType ?? 'Other';
        const count = row._count.id;

        if (!serviceMap.has(serviceKey)) {
          serviceMap.set(serviceKey, {
            serviceId: row.serviceId,
            serviceDescription: row.serviceDescription,
            skuCount: 0,
            families: [],
          });
        }

        const serviceNode = serviceMap.get(serviceKey)!;
        serviceNode.skuCount += count;

        // Find or create family
        let familyNode = serviceNode.families.find((f) => f.resourceFamily === family);
        if (!familyNode) {
          familyNode = { resourceFamily: family, skuCount: 0, groups: [] };
          serviceNode.families.push(familyNode);
        }
        familyNode.skuCount += count;

        // Find or create group
        let groupNode = familyNode.groups.find((g) => g.resourceGroup === group);
        if (!groupNode) {
          groupNode = { resourceGroup: group, skuCount: 0, usageTypes: [] };
          familyNode.groups.push(groupNode);
        }
        groupNode.skuCount += count;

        // Add usage type
        const existingUsageType = groupNode.usageTypes.find((u) => u.usageType === usageType);
        if (existingUsageType) {
          existingUsageType.skuCount += count;
        } else {
          groupNode.usageTypes.push({ usageType, skuCount: count });
        }
      }

      const services = Array.from(serviceMap.values());

      return success({
        data: services,
        total: services.length,
      });
    } catch (error) {
      console.error('Failed to load SKU categories:', error);
      return serverError('Failed to retrieve SKU categories');
    }
  }
);
