/**
 * /api/raw-cost
 *
 * Raw cost data query endpoint.
 * Query imported GCP billing data.
 *
 * GET - Query raw cost entries
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { getProjectIdsForUserScope, hasCustomerScope, getCustomerScopes } from '@/lib/auth/context';
import { rawCostQuerySchema, success, serverError, forbidden } from '@/lib/utils';

/**
 * GET /api/raw-cost
 *
 * Query raw cost entries with optional filters.
 * Requires raw_cost:read permission.
 *
 * Results are scoped to projects bound to user's customers.
 * Super admin sees all.
 *
 * Query params:
 *   - month: filter by billing month (YYYY-MM)
 *   - projectId: filter by GCP project ID
 *   - customerId: filter by customer (shows projects bound to that customer)
 *   - page, limit: pagination
 */
export const GET = withPermission(
  { resource: 'raw_cost', action: 'read' },
  async (request, context): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);

      // Parse and validate query params
      const params = rawCostQuerySchema.safeParse({
        month: searchParams.get('month'),
        projectId: searchParams.get('projectId'),
        customerId: searchParams.get('customerId'),
        page: searchParams.get('page'),
        limit: searchParams.get('limit'),
      });

      const query = params.success ? params.data : { page: 1, limit: 100 };
      const skip = (query.page - 1) * query.limit;

      // Build where clause
      const where: Record<string, unknown> = {};

      // Month filter - extract month from usageStartTime
      if (query.month) {
        const [year, month] = query.month.split('-').map(Number);
        const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
        const endOfMonth = new Date(Date.UTC(year, month, 1));

        where.usageStartTime = {
          gte: startOfMonth,
          lt: endOfMonth,
        };
      }

      // Project filter
      if (query.projectId) {
        where.projectId = query.projectId;
      }

      // Customer filter - get projects bound to that customer
      // IMPORTANT: Enforce customer scope for non-super-admin users
      if (query.customerId) {
        // Check if user has access to this customer
        if (!hasCustomerScope(context.auth, query.customerId)) {
          return forbidden('You do not have access to this customer');
        }

        const customerProjects = await prisma.customerProject.findMany({
          where: {
            customerId: query.customerId,
            isActive: true,
          },
          include: {
            project: { select: { projectId: true } },
          },
        });
        const projectIds = customerProjects.map((cp) => cp.project.projectId);

        if (projectIds.length === 0) {
          // Customer has no bound projects
          return success({
            data: [],
            aggregates: { totalCost: '0', totalUsage: '0', entriesCount: 0 },
            pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 0 },
          });
        }

        where.projectId = { in: projectIds };
      } else {
        // No customerId provided - apply scope filtering
        // Non-super-admin users can only see their scoped customers' projects
        const scopedProjectIds = await getProjectIdsForUserScope(context.auth);
        if (scopedProjectIds !== null) {
          if (scopedProjectIds.length === 0) {
            // User has no project access
            return success({
              data: [],
              aggregates: { totalCost: '0', totalUsage: '0', entriesCount: 0 },
              pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 0 },
            });
          }

          // Intersect with existing projectId filter if present
          if (where.projectId) {
            if (typeof where.projectId === 'string') {
              if (!scopedProjectIds.includes(where.projectId)) {
                return forbidden('You do not have access to this project');
              }
            }
          } else {
            where.projectId = { in: scopedProjectIds };
          }
        }
      }

      // If projectId filter specified, verify scope access
      if (query.projectId && !context.auth.isSuperAdmin) {
        const scopedProjectIds = await getProjectIdsForUserScope(context.auth);
        if (scopedProjectIds !== null && !scopedProjectIds.includes(query.projectId)) {
          return forbidden('You do not have access to this project');
        }
        where.projectId = query.projectId;
      } else if (query.projectId) {
        where.projectId = query.projectId;
      }

      // Execute queries in parallel
      const [entries, total, aggregates] = await Promise.all([
        prisma.rawCostEntry.findMany({
          where,
          skip,
          take: query.limit,
          orderBy: { usageStartTime: 'desc' },
          include: {
            ingestionBatch: {
              select: {
                id: true,
                source: true,
                month: true,
              },
            },
          },
        }),
        prisma.rawCostEntry.count({ where }),
        prisma.rawCostEntry.aggregate({
          where,
          _sum: {
            cost: true,
            usageAmount: true,
          },
          _count: true,
        }),
      ]);

      // Transform response
      const data = entries.map((e) => ({
        id: e.id,
        billingAccountId: e.billingAccountId,
        projectId: e.projectId,
        serviceId: e.serviceId,
        skuId: e.skuId,
        usageStartTime: e.usageStartTime,
        usageEndTime: e.usageEndTime,
        usageAmount: e.usageAmount.toString(),
        cost: e.cost.toString(),
        currency: e.currency,
        region: e.region,
        ingestionBatch: {
          id: e.ingestionBatch.id,
          source: e.ingestionBatch.source,
          month: e.ingestionBatch.month,
        },
      }));

      return success({
        data,
        aggregates: {
          totalCost: aggregates._sum.cost?.toString() ?? '0',
          totalUsage: aggregates._sum.usageAmount?.toString() ?? '0',
          entriesCount: aggregates._count,
        },
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      });

    } catch (error) {
      console.error('Failed to query raw cost data:', error);
      return serverError('Failed to query raw cost data');
    }
  }
);
