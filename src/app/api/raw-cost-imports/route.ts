/**
 * /api/raw-cost-imports
 *
 * Raw cost ingestion batch management endpoint.
 *
 * GET - List all ingestion batches
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { paginationSchema, success, serverError } from '@/lib/utils';

/**
 * GET /api/raw-cost-imports
 *
 * List all raw cost ingestion batches.
 * Requires raw_cost:read permission.
 */
export const GET = withPermission(
  { resource: 'raw_cost', action: 'read' },
  async (request: NextRequest): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);

      // Parse pagination
      const pagination = paginationSchema.safeParse({
        page: searchParams.get('page'),
        limit: searchParams.get('limit'),
      });

      const page = pagination.success ? pagination.data.page : 1;
      const limit = pagination.success ? pagination.data.limit : 20;
      const skip = (page - 1) * limit;

      // Optional filters
      const month = searchParams.get('month');
      const source = searchParams.get('source');

      // Build where clause
      const where: Record<string, unknown> = {};

      if (month) {
        where.month = month;
      }

      if (source) {
        where.source = source;
      }

      // Execute queries in parallel
      const [batches, total] = await Promise.all([
        prisma.rawCostIngestionBatch.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            creator: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        }),
        prisma.rawCostIngestionBatch.count({ where }),
      ]);

      // Get summary stats for each batch
      const batchIds = batches.map((b) => b.id);
      const batchStats = await prisma.rawCostEntry.groupBy({
        by: ['ingestionBatchId'],
        where: { ingestionBatchId: { in: batchIds } },
        _sum: { cost: true },
        _count: true,
      });

      const statsMap = new Map(
        batchStats.map((s) => [
          s.ingestionBatchId,
          { entryCount: s._count, totalCost: Number(s._sum.cost || 0) },
        ])
      );

      const data = batches.map((batch) => {
        const stats = statsMap.get(batch.id) || { entryCount: 0, totalCost: 0 };
        return {
          id: batch.id,
          month: batch.month,
          source: batch.source,
          rowCount: batch.rowCount,
          checksum: batch.checksum,
          status: batch.status,
          createdBy: batch.creator,
          createdAt: batch.createdAt,
          entryCount: stats.entryCount,
          totalCost: stats.totalCost,
        };
      });

      // Get available months and sources for filters
      const [months, sources] = await Promise.all([
        prisma.rawCostIngestionBatch.findMany({
          distinct: ['month'],
          select: { month: true },
          orderBy: { month: 'desc' },
        }),
        prisma.rawCostIngestionBatch.findMany({
          distinct: ['source'],
          select: { source: true },
        }),
      ]);

      return success({
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        filters: {
          months: months.map((m) => m.month).filter(Boolean),
          sources: sources.map((s) => s.source),
        },
      });

    } catch (error) {
      console.error('Failed to list raw cost imports:', error);
      return serverError('Failed to retrieve raw cost imports');
    }
  }
);
