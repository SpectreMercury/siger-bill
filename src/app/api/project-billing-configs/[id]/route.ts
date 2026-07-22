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
import { AuditAction, Prisma, ProjectChargeType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { hasCustomerScope } from '@/lib/auth/context';
import { withPermission } from '@/lib/middleware';
import { logAuditEvent, logDelete } from '@/lib/audit';
import {
  chargeTypeToBillable,
  PROJECT_CHARGE_TYPES,
} from '@/lib/project-billing-configs/charge-type';
import { ensureActiveCustomerProjectBinding } from '@/lib/project-billing-configs/bindings';
import {
  validateBody,
  validationError,
  success,
  serverError,
  notFound,
  conflict,
  forbidden,
} from '@/lib/utils';

const updateSchema = z.object({
  projectId: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().max(255).optional().nullable(),
  chargeType: z.enum(PROJECT_CHARGE_TYPES).optional(),
  billable: z.boolean().optional(),
  billingAccountId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
});

const operatorSelect = { id: true, firstName: true, lastName: true, email: true } as const;
const billingAccountSelect = { id: true, billingAccountId: true, name: true } as const;

class ProjectBillingConfigForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectBillingConfigForbiddenError';
  }
}

class ProjectBillingConfigNotFoundError extends Error {
  constructor() {
    super('Config not found');
    this.name = 'ProjectBillingConfigNotFoundError';
  }
}

export const PUT = withPermission(
  { resource: 'project_billing_configs', action: 'update' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id } = context.params;
      const existing = await prisma.projectBillingConfig.findUnique({
        where: { id },
        include: {
          customerProjects: {
            where: { isActive: true },
            select: { customerId: true },
          },
        },
      });
      if (!existing) return notFound('Config');
      const inaccessibleCurrentBinding = existing.customerProjects.find(
        (binding) => !hasCustomerScope(context.auth, binding.customerId)
      );
      if (inaccessibleCurrentBinding) {
        return forbidden('You do not have access to the currently bound customer');
      }

      const validation = await validateBody(request, updateSchema);
      if (!validation.success) return validationError(validation.error);

      const data = validation.data;
      const selectedCustomer = data.customerId
        ? await prisma.customer.findUnique({
            where: { id: data.customerId },
            select: { id: true, name: true },
          })
        : null;
      if (data.customerId && !selectedCustomer) return notFound('Customer');
      if (selectedCustomer && !hasCustomerScope(context.auth, selectedCustomer.id)) {
        return forbidden('You do not have access to this customer');
      }
      if (data.billingAccountId) {
        const billingAccount = await prisma.billingAccount.findUnique({
          where: { id: data.billingAccountId },
          select: { id: true },
        });
        if (!billingAccount) return notFound('Billing account');
      }

      const updateData: Prisma.ProjectBillingConfigUpdateInput = {
        updater: { connect: { id: context.auth.userId } },
      };
      if (data.projectId !== undefined) updateData.projectId = data.projectId;
      if (data.name !== undefined) updateData.name = data.name;
      if (data.chargeType !== undefined) {
        updateData.chargeType = data.chargeType;
        updateData.billable = chargeTypeToBillable(data.chargeType);
      } else if (data.billable !== undefined) {
        updateData.billable = data.billable;
        updateData.chargeType = data.billable
          ? ProjectChargeType.BILLABLE
          : ProjectChargeType.NON_BILLABLE;
      }
      if (data.billingAccountId !== undefined) {
        updateData.billingAccount = data.billingAccountId === null
          ? { disconnect: true }
          : { connect: { id: data.billingAccountId } };
      }

      try {
        const result = await prisma.$transaction(async (tx) => {
          const transactionalExisting = await tx.projectBillingConfig.findUnique({
            where: { id },
            include: {
              customerProjects: {
                where: { isActive: true },
                select: { customerId: true },
              },
            },
          });
          if (!transactionalExisting) throw new ProjectBillingConfigNotFoundError();
          if (
            transactionalExisting.customerProjects.some(
              (binding) => !hasCustomerScope(context.auth, binding.customerId)
            )
          ) {
            throw new ProjectBillingConfigForbiddenError(
              'You do not have access to the currently bound customer'
            );
          }

          const row = await tx.projectBillingConfig.update({
            where: { id },
            data: updateData,
            include: {
              billingAccount: { select: billingAccountSelect },
              creator: { select: operatorSelect },
              updater: { select: operatorSelect },
            },
          });

          if (data.customerId !== undefined) {
            await tx.customerProject.updateMany({
              where: {
                projectId: row.projectId,
                isActive: true,
                ...(selectedCustomer ? { customerId: { not: selectedCustomer.id } } : {}),
              },
              data: {
                isActive: false,
                endDate: new Date(),
              },
            });
            if (selectedCustomer) {
              await ensureActiveCustomerProjectBinding(
                tx,
                selectedCustomer.id,
                row.projectId
              );
            }
          }

          const bindings = await tx.customerProject.findMany({
            where: { projectId: row.projectId, isActive: true },
            select: {
              startDate: true,
              endDate: true,
              customer: { select: { id: true, name: true } },
            },
          });

          await logAuditEvent(context, {
            action: AuditAction.UPDATE,
            targetTable: 'project_billing_configs',
            targetId: id,
            beforeData: {
              projectId: transactionalExisting.projectId,
              name: transactionalExisting.name,
              billable: transactionalExisting.billable,
              chargeType: transactionalExisting.chargeType,
              billingAccountId: transactionalExisting.billingAccountId,
              customerIds: transactionalExisting.customerProjects.map(
                (binding) => binding.customerId
              ),
            },
            afterData: {
              projectId: row.projectId,
              name: row.name,
              billable: row.billable,
              chargeType: row.chargeType,
              billingAccountId: row.billingAccountId,
              customerIds: bindings.map((binding) => binding.customer.id),
            },
          }, { db: tx, strict: true });
          return { row, bindings };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        const { row, bindings } = result;

        return success({
          message: 'Config updated',
          config: {
            id: row.id,
            projectId: row.projectId,
            name: row.name,
            billable: row.billable,
            chargeType: row.chargeType,
            billingAccount: row.billingAccount,
            boundCustomers: bindings.map((binding) => ({
              customerId: binding.customer.id,
              customerName: binding.customer.name,
              startDate: binding.startDate,
              endDate: binding.endDate,
            })),
            createdBy: row.creator,
            updatedBy: row.updater,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        });
      } catch (err) {
        if (err instanceof ProjectBillingConfigForbiddenError) {
          return forbidden(err.message);
        }
        if (err instanceof ProjectBillingConfigNotFoundError) {
          return notFound('Config');
        }
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return conflict('Another registry row already uses this projectId');
        }
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
          return conflict('Project config changed concurrently; please retry');
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
        chargeType: existing.chargeType,
        billingAccountId: existing.billingAccountId,
      });

      return success({ deleted: true });
    } catch (error) {
      console.error('Failed to delete project billing config:', error);
      return serverError('Failed to delete config');
    }
  }
);
