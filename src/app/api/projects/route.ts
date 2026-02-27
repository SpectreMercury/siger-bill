/**
 * /api/projects
 *
 * GCP Project management endpoints.
 * Projects belong to billing accounts and can be bound to customers.
 *
 * GET  - List all projects
 * POST - Create/register a new project
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logCreate } from '@/lib/audit';
import {
  validateBody,
  createProjectSchema,
  paginationSchema,
  validationError,
  success,
  created,
  serverError,
  conflict,
  notFound,
} from '@/lib/utils';

/**
 * GET /api/projects
 *
 * List all projects with pagination.
 * Requires projects:list permission.
 *
 * Query params:
 *   - billingAccountId: filter by GCP billing account ID
 *   - status: filter by status (ACTIVE, INACTIVE)
 *   - unbound: if "true", only show projects not bound to any customer
 */
export const GET = withPermission(
  { resource: 'projects', action: 'list' },
  async (request): Promise<NextResponse> => {
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

      // Build where clause
      const where: Record<string, unknown> = {};

      const statusParam = searchParams.get('status');
      if (statusParam === 'ACTIVE' || statusParam === 'INACTIVE') {
        where.status = statusParam;
      }

      const billingAccountIdParam = searchParams.get('billingAccountId');
      if (billingAccountIdParam) {
        // Look up the billing account by its external ID
        const ba = await prisma.billingAccount.findUnique({
          where: { billingAccountId: billingAccountIdParam },
        });
        if (ba) {
          where.billingAccountId = ba.id;
        } else {
          // No matching billing account, return empty
          return success({
            data: [],
            pagination: { page, limit, total: 0, totalPages: 0 },
          });
        }
      }

      // If unbound=true, filter to projects with no active customer bindings
      const unboundParam = searchParams.get('unbound');
      if (unboundParam === 'true') {
        where.customerProjects = { none: { isActive: true } };
      }

      // Execute queries in parallel
      const [projects, total] = await Promise.all([
        prisma.project.findMany({
          where,
          skip,
          take: limit,
          orderBy: { projectId: 'asc' },
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
        }),
        prisma.project.count({ where }),
      ]);

      // Transform response
      const data = projects.map((p) => ({
        id: p.id,
        projectId: p.projectId,
        projectNumber: p.projectNumber,
        name: p.name,
        iamRole: p.iamRole,
        status: p.status,
        billingAccount: p.billingAccount
          ? {
              billingAccountId: p.billingAccount.billingAccountId,
              name: p.billingAccount.name,
            }
          : null,
        boundCustomers: p.customerProjects.map((cp) => ({
          customerId: cp.customer.id,
          customerName: cp.customer.name,
          startDate: cp.startDate,
          endDate: cp.endDate,
        })),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
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
      console.error('Failed to list projects:', error);
      return serverError('Failed to retrieve projects');
    }
  }
);

/**
 * POST /api/projects
 *
 * Create/register a new GCP project.
 * Requires projects:create permission.
 */
export const POST = withPermission(
  { resource: 'projects', action: 'create' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      // Validate request body
      const validation = await validateBody(request, createProjectSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const data = validation.data;

      // Check for duplicate
      const existing = await prisma.project.findUnique({
        where: { projectId: data.projectId },
      });
      if (existing) {
        return conflict(`Project '${data.projectId}' already exists`);
      }

      // If billingAccountId provided, verify it exists
      let billingAccountDbId: string | null = null;
      if (data.billingAccountId) {
        const ba = await prisma.billingAccount.findUnique({
          where: { billingAccountId: data.billingAccountId },
        });
        if (!ba) {
          return notFound(`Billing account '${data.billingAccountId}' not found`);
        }
        billingAccountDbId = ba.id;
      }

      // Create project
      const project = await prisma.project.create({
        data: {
          projectId: data.projectId,
          projectNumber: data.projectNumber ?? null,
          name: data.name,
          iamRole: data.iamRole ?? null,
          billingAccountId: billingAccountDbId,
        },
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
      await logCreate(
        context,
        'projects',
        project.id,
        project as unknown as Record<string, unknown>
      );

      return created({
        id: project.id,
        projectId: project.projectId,
        projectNumber: project.projectNumber,
        name: project.name,
        iamRole: project.iamRole,
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
      console.error('Failed to create project:', error);
      return serverError('Failed to create project');
    }
  }
);
