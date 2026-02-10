/**
 * /api/projects/[id]
 *
 * Individual project management endpoints.
 *
 * GET  - Get project details
 * PUT  - Update project
 * DELETE - Delete project
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logUpdate, logDelete } from '@/lib/audit';
import {
  success,
  notFound,
  serverError,
  validationError,
  badRequest,
} from '@/lib/utils';
import { z } from 'zod';

const updateProjectSchema = z.object({
  name: z.string().max(255).nullable().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'NOT_FOUND', 'NO_BILLING']).optional(),
});

/**
 * GET /api/projects/[id]
 *
 * Get project details by ID.
 */
export const GET = withPermission(
  { resource: 'projects', action: 'read' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id } = context.params;

      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          billingAccount: {
            select: {
              billingAccountId: true,
              name: true,
            },
          },
          customerProjects: {
            where: { isActive: true },
            include: {
              customer: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      if (!project) {
        return notFound('Project not found');
      }

      return success({
        id: project.id,
        projectId: project.projectId,
        name: project.name,
        status: project.status,
        billingAccount: project.billingAccount
          ? {
              billingAccountId: project.billingAccount.billingAccountId,
              name: project.billingAccount.name,
            }
          : null,
        boundCustomers: project.customerProjects.map((cp) => ({
          customerId: cp.customer.id,
          customerName: cp.customer.name,
          startDate: cp.startDate,
          endDate: cp.endDate,
        })),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      });
    } catch (error) {
      console.error('Failed to get project:', error);
      return serverError('Failed to retrieve project');
    }
  }
);

/**
 * PUT /api/projects/[id]
 *
 * Update project details.
 */
export const PUT = withPermission(
  { resource: 'projects', action: 'update' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id } = context.params;

      // Parse and validate body
      const body = await request.json();
      const validation = updateProjectSchema.safeParse(body);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const data = validation.data;

      // Check project exists
      const existing = await prisma.project.findUnique({
        where: { id },
      });

      if (!existing) {
        return notFound('Project not found');
      }

      // Build update data
      const updateData: Record<string, unknown> = {};
      if (data.name !== undefined) {
        updateData.name = data.name || null;
      }
      if (data.status !== undefined) {
        updateData.status = data.status;
      }

      // Update project
      const project = await prisma.project.update({
        where: { id },
        data: updateData,
        include: {
          billingAccount: {
            select: {
              billingAccountId: true,
              name: true,
            },
          },
        },
      });

      // Audit log
      await logUpdate(
        context,
        'projects',
        project.id,
        existing as unknown as Record<string, unknown>,
        project as unknown as Record<string, unknown>
      );

      return success({
        id: project.id,
        projectId: project.projectId,
        name: project.name,
        status: project.status,
        billingAccount: project.billingAccount
          ? {
              billingAccountId: project.billingAccount.billingAccountId,
              name: project.billingAccount.name,
            }
          : null,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      });
    } catch (error) {
      console.error('Failed to update project:', error);
      return serverError('Failed to update project');
    }
  }
);

/**
 * DELETE /api/projects/[id]
 *
 * Delete a project.
 */
export const DELETE = withPermission(
  { resource: 'projects', action: 'delete' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id } = context.params;

      // Check project exists
      const existing = await prisma.project.findUnique({
        where: { id },
        include: {
          customerProjects: {
            where: { isActive: true },
          },
        },
      });

      if (!existing) {
        return notFound('Project not found');
      }

      // Check if project has active customer bindings
      if (existing.customerProjects.length > 0) {
        return badRequest('Cannot delete project with active customer bindings');
      }

      // Delete project
      await prisma.project.delete({
        where: { id },
      });

      // Audit log
      await logDelete(
        context,
        'projects',
        id,
        existing as unknown as Record<string, unknown>
      );

      return success({ deleted: true });
    } catch (error) {
      console.error('Failed to delete project:', error);
      return serverError('Failed to delete project');
    }
  }
);
