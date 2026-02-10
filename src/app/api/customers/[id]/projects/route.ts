/**
 * /api/customers/:id/projects
 *
 * Customer-Project binding management.
 * Binds GCP projects to customers for billing purposes.
 *
 * GET  - List projects bound to this customer
 * POST - Bind a project to this customer
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermissionAndScope } from '@/lib/middleware';
import { logAuditEvent } from '@/lib/audit';
import { AuditAction } from '@prisma/client';
import {
  validateBody,
  bindProjectSchema,
  paginationSchema,
  validationError,
  success,
  created,
  serverError,
  notFound,
  conflict,
} from '@/lib/utils';

/**
 * GET /api/customers/:id/projects
 *
 * List all projects bound to this customer.
 * Requires customer_projects:list permission and customer scope.
 */
export const GET = withPermissionAndScope(
  { resource: 'customer_projects', action: 'list' },
  (_request, routeParams) => routeParams?.params.id ?? null,
  async (request, context): Promise<NextResponse> => {
    try {
      const customerId = context.params.id;
      const { searchParams } = new URL(request.url);

      // Verify customer exists
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
      });
      if (!customer) {
        return notFound('Customer not found');
      }

      // Parse pagination
      const pagination = paginationSchema.safeParse({
        page: searchParams.get('page'),
        limit: searchParams.get('limit'),
      });

      const page = pagination.success ? pagination.data.page : 1;
      const limit = pagination.success ? pagination.data.limit : 20;
      const skip = (page - 1) * limit;

      // Filter by active/inactive bindings
      const activeParam = searchParams.get('active');
      const isActive = activeParam === 'false' ? false : true;

      const where = {
        customerId,
        isActive,
      };

      // Execute queries in parallel
      const [bindings, total] = await Promise.all([
        prisma.customerProject.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            project: {
              include: {
                billingAccount: {
                  select: {
                    billingAccountId: true,
                    name: true,
                  },
                },
              },
            },
          },
        }),
        prisma.customerProject.count({ where }),
      ]);

      // Transform response
      const data = bindings.map((b) => ({
        id: b.id,
        projectId: b.project.projectId,
        projectName: b.project.name,
        billingAccount: b.project.billingAccount
          ? {
              billingAccountId: b.project.billingAccount.billingAccountId,
              name: b.project.billingAccount.name,
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
 * POST /api/customers/:id/projects
 *
 * Bind a project to this customer.
 * Requires customer_projects:bind permission and customer scope.
 *
 * A project can only be actively bound to one customer at a time.
 */
export const POST = withPermissionAndScope(
  { resource: 'customer_projects', action: 'bind' },
  (_request, routeParams) => routeParams?.params.id ?? null,
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const customerId = context.params.id;

      // Verify customer exists
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
      });
      if (!customer) {
        return notFound('Customer not found');
      }

      // Validate request body
      const validation = await validateBody(request, bindProjectSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const data = validation.data;

      // Find the project
      const project = await prisma.project.findUnique({
        where: { projectId: data.projectId },
      });
      if (!project) {
        return notFound(`Project '${data.projectId}' not found`);
      }

      // Check if project is already actively bound to another customer
      const existingBinding = await prisma.customerProject.findFirst({
        where: {
          projectId: project.id,
          isActive: true,
        },
        include: {
          customer: { select: { name: true } },
        },
      });

      if (existingBinding) {
        if (existingBinding.customerId === customerId) {
          return conflict(`Project '${data.projectId}' is already bound to this customer`);
        }
        return conflict(
          `Project '${data.projectId}' is already bound to customer '${existingBinding.customer.name}'`
        );
      }

      // Parse dates
      const startDate = data.startDate ? new Date(data.startDate) : null;
      const endDate = data.endDate ? new Date(data.endDate) : null;

      // Create binding
      const binding = await prisma.customerProject.create({
        data: {
          customerId,
          projectId: project.id,
          startDate,
          endDate,
          isActive: true,
        },
        include: {
          project: true,
        },
      });

      // Audit log
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
        projectId: binding.project.projectId,
        projectName: binding.project.name,
        startDate: binding.startDate,
        endDate: binding.endDate,
        isActive: binding.isActive,
        createdAt: binding.createdAt,
      });

    } catch (error) {
      console.error('Failed to bind project to customer:', error);
      return serverError('Failed to bind project to customer');
    }
  }
);
