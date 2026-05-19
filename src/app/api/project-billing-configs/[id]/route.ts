/**
 * /api/project-billing-configs/[id]
 *
 * PUT    - Update an existing registry row (projectId, name, billable,
 *          billingAccountId). Sets updatedBy to current user.
 * DELETE - Remove a registry row. Will fail with FK violation if any active
 *          CustomerProject still references this projectId.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logUpdate, logDelete } from '@/lib/audit';
import {
  validateBody,
  validationError,
  success,
  serverError,
  notFound,
  conflict,
} from '@/lib/utils';

const updateSchema = z.object({
  projectId: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().max(255).optional().nullable(),
  billable: z.boolean().optional(),
  billingAccountId: z.string().uuid().optional().nullable(),
});

const operatorSelect = { id: true, firstName: true, lastName: true, email: true } as const;
const billingAccountSelect = { id: true, billingAccountId: true, name: true } as const;

export const PUT = withPermission(
  { resource: 'project_billing_configs', action: 'update' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id } = context.params;
      const existing = await prisma.projectBillingConfig.findUnique({ where: { id } });
      if (!existing) return notFound('Config');

      const validation = await validateBody(request, updateSchema);
      if (!validation.success) return validationError(validation.error);

      const data = validation.data;
      const updateData: Prisma.ProjectBillingConfigUpdateInput = {
        updater: { connect: { id: context.auth.userId } },
      };
      if (data.projectId !== undefined) updateData.projectId = data.projectId;
      if (data.name !== undefined) updateData.name = data.name;
      if (data.billable !== undefined) updateData.billable = data.billable;
      if (data.billingAccountId !== undefined) {
        updateData.billingAccount = data.billingAccountId === null
          ? { disconnect: true }
          : { connect: { id: data.billingAccountId } };
      }

      try {
        const row = await prisma.projectBillingConfig.update({
          where: { id },
          data: updateData,
          include: {
            billingAccount: { select: billingAccountSelect },
            creator: { select: operatorSelect },
            updater: { select: operatorSelect },
          },
        });

        await logUpdate(
          context,
          'project_billing_configs',
          id,
          {
            projectId: existing.projectId,
            name: existing.name,
            billable: existing.billable,
            billingAccountId: existing.billingAccountId,
          },
          {
            projectId: row.projectId,
            name: row.name,
            billable: row.billable,
            billingAccountId: row.billingAccountId,
          }
        );

        return success({
          message: 'Config updated',
          config: {
            id: row.id,
            projectId: row.projectId,
            name: row.name,
            billable: row.billable,
            billingAccount: row.billingAccount,
            createdBy: row.creator,
            updatedBy: row.updater,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return conflict('Another registry row already uses this projectId');
        }
        throw err;
      }
    } catch (error) {
      console.error('Failed to update project billing config:', error);
      return serverError('Failed to update config');
    }
  }
);

export const DELETE = withPermission(
  { resource: 'project_billing_configs', action: 'delete' },
  async (_request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id } = context.params;
      const existing = await prisma.projectBillingConfig.findUnique({ where: { id } });
      if (!existing) return notFound('Config');

      try {
        await prisma.projectBillingConfig.delete({ where: { id } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
          return conflict(
            `Cannot delete: project '${existing.projectId}' is still bound to one or more customers`
          );
        }
        throw err;
      }

      await logDelete(context, 'project_billing_configs', id, {
        projectId: existing.projectId,
        name: existing.name,
        billable: existing.billable,
        billingAccountId: existing.billingAccountId,
      });

      return success({ deleted: true });
    } catch (error) {
      console.error('Failed to delete project billing config:', error);
      return serverError('Failed to delete config');
    }
  }
);
