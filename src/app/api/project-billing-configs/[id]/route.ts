/**
 * /api/project-billing-configs/[id]
 *
 * PUT    - Update an existing config (billable, projectId, customerId).
 *          Sets updatedBy to current user.
 * DELETE - Remove a config.
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
  customerId: z.string().uuid().optional(),
  billable: z.boolean().optional(),
});

const operatorSelect = { id: true, firstName: true, lastName: true, email: true } as const;
const customerSelect = { id: true, name: true, externalId: true } as const;

export const PUT = withPermission(
  { resource: 'project_billing_configs', action: 'update' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id } = context.params;
      const existing = await prisma.projectBillingConfig.findUnique({ where: { id } });
      if (!existing) return notFound('Config');

      const validation = await validateBody(request, updateSchema);
      if (!validation.success) return validationError(validation.error);

      const updateData: Prisma.ProjectBillingConfigUpdateInput = {
        updater: { connect: { id: context.auth.userId } },
      };
      const data = validation.data;
      if (data.projectId !== undefined) updateData.projectId = data.projectId;
      if (data.customerId !== undefined) {
        updateData.customer = { connect: { id: data.customerId } };
      }
      if (data.billable !== undefined) updateData.billable = data.billable;

      try {
        const row = await prisma.projectBillingConfig.update({
          where: { id },
          data: updateData,
          include: {
            customer: { select: customerSelect },
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
            customerId: existing.customerId,
            billable: existing.billable,
          },
          {
            projectId: row.projectId,
            customerId: row.customerId,
            billable: row.billable,
          }
        );

        return success({
          message: 'Config updated',
          config: {
            id: row.id,
            projectId: row.projectId,
            billable: row.billable,
            customer: row.customer,
            createdBy: row.creator,
            updatedBy: row.updater,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return conflict('A config for this (project, customer) pair already exists');
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

      await prisma.projectBillingConfig.delete({ where: { id } });

      await logDelete(context, 'project_billing_configs', id, {
        projectId: existing.projectId,
        customerId: existing.customerId,
        billable: existing.billable,
      });

      return success({ deleted: true });
    } catch (error) {
      console.error('Failed to delete project billing config:', error);
      return serverError('Failed to delete config');
    }
  }
);
