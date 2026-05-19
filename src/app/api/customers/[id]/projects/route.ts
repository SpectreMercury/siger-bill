/**
 * /api/customers/:id/projects
 *
 * Customer ↔ project binding management.
 *
 * GET  - List active bindings for this customer (joined with project registry)
 * POST - Bind a single project to this customer (back-compat, single bind)
 * PUT  - Bulk replace the customer's bindings (drawer flow). Body:
 *        { projectIds: string[] }
 *        Server diffs against current active bindings and atomically
 *        adds/removes — single transaction, no N+1.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermissionAndScope } from '@/lib/middleware';
import { logAuditEvent } from '@/lib/audit';
import { AuditAction } from '@prisma/client';
import {
  validateBody,
  bindProjectSchema,
  bulkSetCustomerProjectsSchema,
  paginationSchema,
  validationError,
  success,
  created,
  serverError,
  notFound,
  conflict,
} from '@/lib/utils';

/**
 * Domain error: a project the caller tried to bind is already active on
 * another customer. Caught at the route boundary and turned into a 409.
 */
class BindingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BindingConflictError';
  }
}

/**
 * GET /api/customers/:id/projects
 */
export const GET = withPermissionAndScope(
  { resource: 'customer_projects', action: 'list' },
  (_request, routeParams) => routeParams?.params.id ?? null,
  async (request, context): Promise<NextResponse> => {
    try {
      const customerId = context.params.id;
      const { searchParams } = new URL(request.url);

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true },
      });
      if (!customer) {
        return notFound('Customer not found');
      }

      const pagination = paginationSchema.safeParse({
        page: searchParams.get('page'),
        limit: searchParams.get('limit'),
      });
      const page = pagination.success ? pagination.data.page : 1;
      const limit = pagination.success ? pagination.data.limit : 20;
      const skip = (page - 1) * limit;

      const activeParam = searchParams.get('active');
      const isActive = activeParam === 'false' ? false : true;

      const where = { customerId, isActive };

      const [bindings, total] = await Promise.all([
        prisma.customerProject.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            projectId: true,
            startDate: true,
            endDate: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
            projectBillingConfig: {
              select: {
                name: true,
                billable: true,
                billingAccount: {
                  select: { billingAccountId: true, name: true },
                },
              },
            },
          },
        }),
        prisma.customerProject.count({ where }),
      ]);

      const data = bindings.map((b) => ({
        id: b.id,
        projectId: b.projectId,
        projectName: b.projectBillingConfig?.name ?? null,
        billable: b.projectBillingConfig?.billable ?? true,
        billingAccount: b.projectBillingConfig?.billingAccount
          ? {
              billingAccountId: b.projectBillingConfig.billingAccount.billingAccountId,
              name: b.projectBillingConfig.billingAccount.name,
            }
          : null,
        startDate: b.startDate,
        endDate: b.endDate,
        isActive: b.isActive,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
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
      console.error('Failed to list customer projects:', error);
      return serverError('Failed to retrieve customer projects');
    }
  }
);

/**
 * POST /api/customers/:id/projects — single bind (back-compat).
 * Auto-registers projectId in ProjectBillingConfig if not yet present.
 */
export const POST = withPermissionAndScope(
  { resource: 'customer_projects', action: 'bind' },
  (_request, routeParams) => routeParams?.params.id ?? null,
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const customerId = context.params.id;

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, name: true },
      });
      if (!customer) {
        return notFound('Customer not found');
      }

      const validation = await validateBody(request, bindProjectSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }
      const data = validation.data;

      const startDate = data.startDate ? new Date(data.startDate) : null;
      const endDate = data.endDate ? new Date(data.endDate) : null;

      const binding = await prisma.$transaction(async (tx) => {
        const existingActive = await tx.customerProject.findFirst({
          where: { projectId: data.projectId, isActive: true },
          select: { id: true, customerId: true, customer: { select: { name: true } } },
        });
        if (existingActive && existingActive.customerId !== customerId) {
          throw new BindingConflictError(
            `Project '${data.projectId}' is already bound to customer '${existingActive.customer.name}'`
          );
        }
        if (existingActive && existingActive.customerId === customerId) {
          throw new BindingConflictError(
            `Project '${data.projectId}' is already bound to this customer`
          );
        }

        await tx.projectBillingConfig.upsert({
          where: { projectId: data.projectId },
          update: {},
          create: {
            projectId: data.projectId,
            billable: true,
            createdBy: context.auth.userId,
            updatedBy: context.auth.userId,
          },
        });

        return tx.customerProject.create({
          data: {
            customerId,
            projectId: data.projectId,
            startDate,
            endDate,
            isActive: true,
          },
          select: {
            id: true,
            projectId: true,
            startDate: true,
            endDate: true,
            isActive: true,
            createdAt: true,
            projectBillingConfig: { select: { name: true } },
          },
        });
      });

      await logAuditEvent(context, {
        action: AuditAction.BIND,
        targetTable: 'customer_projects',
        targetId: binding.id,
        afterData: {
          customerId,
          customerName: customer.name,
          projectId: data.projectId,
          startDate,
          endDate,
        },
      });

      return created({
        id: binding.id,
        customerId,
        projectId: binding.projectId,
        projectName: binding.projectBillingConfig?.name ?? null,
        startDate: binding.startDate,
        endDate: binding.endDate,
        isActive: binding.isActive,
        createdAt: binding.createdAt,
      });
    } catch (error) {
      if (error instanceof BindingConflictError) {
        return conflict(error.message);
      }
      console.error('Failed to bind project to customer:', error);
      return serverError('Failed to bind project to customer');
    }
  }
);

/**
 * PUT /api/customers/:id/projects — bulk replace.
 *
 * Diffs against current active bindings and applies the delta in a single
 * $transaction: createMany() for additions, deleteMany() for removals.
 * No per-row loops.
 */
export const PUT = withPermissionAndScope(
  { resource: 'customer_projects', action: 'bind' },
  (_request, routeParams) => routeParams?.params.id ?? null,
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const customerId = context.params.id;

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, name: true },
      });
      if (!customer) {
        return notFound('Customer not found');
      }

      const validation = await validateBody(request, bulkSetCustomerProjectsSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const target = Array.from(
        new Set(validation.data.projectIds.map((p) => p.trim()).filter(Boolean))
      );

      const result = await prisma.$transaction(async (tx) => {
        const currentRows = await tx.customerProject.findMany({
          where: { customerId, isActive: true },
          select: { projectId: true },
        });
        const currentSet = new Set(currentRows.map((c) => c.projectId));
        const targetSet = new Set(target);

        const toAdd = target.filter((p) => !currentSet.has(p));
        const toRemove = currentRows.map((c) => c.projectId).filter((p) => !targetSet.has(p));
        const unchanged = target.filter((p) => currentSet.has(p));

        if (toAdd.length > 0) {
          const conflicts = await tx.customerProject.findMany({
            where: {
              projectId: { in: toAdd },
              isActive: true,
              customerId: { not: customerId },
            },
            select: {
              projectId: true,
              customer: { select: { name: true } },
            },
          });
          if (conflicts.length > 0) {
            throw new BindingConflictError(
              `These projects are already bound to other customers: ${conflicts
                .map((c) => `${c.projectId} → ${c.customer.name}`)
                .join(', ')}`
            );
          }

          await tx.projectBillingConfig.createMany({
            data: toAdd.map((projectId) => ({
              projectId,
              billable: true,
              createdBy: context.auth.userId,
              updatedBy: context.auth.userId,
            })),
            skipDuplicates: true,
          });

          await tx.customerProject.createMany({
            data: toAdd.map((projectId) => ({
              customerId,
              projectId,
              isActive: true,
              startDate: new Date(),
            })),
            skipDuplicates: true,
          });
        }

        if (toRemove.length > 0) {
          await tx.customerProject.deleteMany({
            where: { customerId, projectId: { in: toRemove }, isActive: true },
          });
        }

        return { toAdd, toRemove, unchanged };
      });

      if (result.toAdd.length > 0) {
        await logAuditEvent(context, {
          action: AuditAction.BIND,
          targetTable: 'customer_projects',
          targetId: customerId,
          afterData: {
            customerId,
            customerName: customer.name,
            addedProjectIds: result.toAdd,
          },
        });
      }
      if (result.toRemove.length > 0) {
        await logAuditEvent(context, {
          action: AuditAction.UNBIND,
          targetTable: 'customer_projects',
          targetId: customerId,
          beforeData: {
            customerId,
            customerName: customer.name,
            removedProjectIds: result.toRemove,
          },
        });
      }

      return success({
        added: result.toAdd.length,
        removed: result.toRemove.length,
        unchanged: result.unchanged.length,
        projectIds: target,
      });
    } catch (error) {
      if (error instanceof BindingConflictError) {
        return conflict(error.message);
      }
      console.error('Failed to bulk replace customer projects:', error);
      return serverError('Failed to update customer projects');
    }
  }
);
