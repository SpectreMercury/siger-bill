/**
 * /api/audit-logs
 *
 * Audit log viewing endpoint.
 *
 * GET - List audit logs with filtering
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { paginationSchema, success, serverError } from '@/lib/utils';
import { AuditAction } from '@prisma/client';

/**
 * GET /api/audit-logs
 *
 * List audit logs with pagination and filtering.
 * Requires audit_logs:read permission.
 */
export const GET = withPermission(
  { resource: 'audit_logs', action: 'read' },
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
      const action = searchParams.get('action') as AuditAction | null;
      const actorId = searchParams.get('actorId');
      const targetTable = searchParams.get('targetTable');
      const startDate = searchParams.get('startDate');
      const endDate = searchParams.get('endDate');

      // Build where clause
      const where: Record<string, unknown> = {};

      if (action && Object.values(AuditAction).includes(action)) {
        where.action = action;
      }

      if (actorId) {
        where.actorId = actorId;
      }

      if (targetTable) {
        where.targetTable = targetTable;
      }

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
          (where.createdAt as Record<string, unknown>).gte = new Date(startDate);
        }
        if (endDate) {
          (where.createdAt as Record<string, unknown>).lte = new Date(endDate);
        }
      }

      // Execute queries in parallel
      const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            actor: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        }),
        prisma.auditLog.count({ where }),
      ]);

      // Get unique actions and tables for filters
      const [actions, tables] = await Promise.all([
        prisma.auditLog.findMany({
          distinct: ['action'],
          select: { action: true },
        }),
        prisma.auditLog.findMany({
          distinct: ['targetTable'],
          select: { targetTable: true },
        }),
      ]);

      const data = logs.map((log) => ({
        id: log.id,
        action: log.action,
        targetTable: log.targetTable,
        targetId: log.targetId,
        actor: log.actor,
        beforeData: log.beforeData,
        afterData: log.afterData,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        metadata: log.metadata,
        createdAt: log.createdAt,
      }));

      return success({
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        filters: {
          actions: actions.map((a) => a.action),
          tables: tables.map((t) => t.targetTable),
        },
      });

    } catch (error) {
      console.error('Failed to list audit logs:', error);
      return serverError('Failed to retrieve audit logs');
    }
  }
);
