/**
 * /api/customers
 *
 * Customer management endpoints with scope-based access control.
 *
 * GET  - List customers (filtered by user scope)
 * POST - Create a new customer
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { buildCustomerScopeFilter } from '@/lib/auth/context';
import { logCreate } from '@/lib/audit';
import {
  validateBody,
  createCustomerSchema,
  paginationSchema,
  validationError,
  success,
  created,
  serverError,
  conflict,
} from '@/lib/utils';

/**
 * GET /api/customers
 *
 * List customers with pagination.
 * Results are filtered based on user's customer scopes.
 * Super admin sees all customers.
 */
export const GET = withPermission(
  { resource: 'customers', action: 'list' },
  async (request, context): Promise<NextResponse> => {
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

      // Build scope filter based on user's access
      // For super_admin, this returns undefined (no filter)
      // For other users, filters to their assigned customer scopes
      const scopeFilter = buildCustomerScopeFilter(context.auth);

      // Build the where clause
      const where = scopeFilter
        ? { id: scopeFilter.customerId }
        : undefined;

      // Execute queries in parallel.
      // chips on the list page: pull the top 3 active bindings per customer
      // + total active binding count, in a single nested select. No N+1.
      const [customers, total] = await Promise.all([
        prisma.customer.findMany({
          where,
          skip,
          take: limit,
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            externalId: true,
            billingAccountId: true,
            domain: true,
            status: true,
            currency: true,
            paymentTermsDays: true,
            primaryContactName: true,
            primaryContactEmail: true,
            gcpConnectionId: true,
            createdAt: true,
            updatedAt: true,
            customerProjects: {
              where: { isActive: true },
              take: 3,
              orderBy: { createdAt: 'desc' },
              select: {
                projectId: true,
                projectBillingConfig: {
                  select: { name: true, billable: true },
                },
              },
            },
            _count: {
              select: {
                customerProjects: { where: { isActive: true } },
              },
            },
          },
        }),
        prisma.customer.count({ where }),
      ]);

      // Flatten chip data for the response shape consumed by the customer list page.
      const data = customers.map(({ customerProjects, _count, ...rest }) => ({
        ...rest,
        projects: customerProjects.map((cp) => ({
          projectId: cp.projectId,
          name: cp.projectBillingConfig?.name ?? null,
          billable: cp.projectBillingConfig?.billable ?? true,
        })),
        projectsCount: _count.customerProjects,
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
      console.error('Failed to list customers:', error);
      return serverError('Failed to retrieve customers');
    }
  }
);

/**
 * POST /api/customers
 *
 * Create a new customer.
 * Requires customers:create permission.
 */
export const POST = withPermission(
  { resource: 'customers', action: 'create' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      // Validate request body
      const validation = await validateBody(request, createCustomerSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const data = validation.data;

      // Check for duplicate external ID
      if (data.externalId) {
        const existing = await prisma.customer.findUnique({
          where: { externalId: data.externalId },
        });
        if (existing) {
          return conflict(`Customer with external ID '${data.externalId}' already exists`);
        }
      }

      // Create customer + auto-bind projects in a transaction.
      // After the binding refactor: ProjectBillingConfig is the project registry
      // (auto-create row if a new projectId shows up), CustomerProject is the
      // binding (FK to PBC.projectId via string). Project (GCP cache) is left
      // untouched — it gets populated separately by Resource Manager sync.
      const customer = await prisma.$transaction(async (tx) => {
        const newCustomer = await tx.customer.create({
          data: {
            name: data.name,
            externalId: data.externalId,
            billingAccountId: data.billingAccountId,
            domain: data.domain,
            currency: data.currency,
            paymentTermsDays: data.paymentTermsDays,
            primaryContactName: data.primaryContactName,
            primaryContactEmail: data.primaryContactEmail,
            gcpConnectionId: data.gcpConnectionId ?? null,
          },
        });

        const projectIds = data.projectIds ?? [];
        if (projectIds.length > 0) {
          // Register projects in PBC if they're not there yet (idempotent).
          await tx.projectBillingConfig.createMany({
            data: projectIds.map((projectId) => ({
              projectId,
              billable: true,
              createdBy: context.auth.userId,
              updatedBy: context.auth.userId,
            })),
            skipDuplicates: true,
          });

          // Bind to the new customer. createMany + skipDuplicates handles the
          // case where a row already exists (it shouldn't, but defensive).
          await tx.customerProject.createMany({
            data: projectIds.map((projectId) => ({
              customerId: newCustomer.id,
              projectId,
              isActive: true,
              startDate: new Date(),
            })),
            skipDuplicates: true,
          });
        }

        return newCustomer;
      });

      // Audit log
      await logCreate(context, 'customers', customer.id, {
        ...customer as unknown as Record<string, unknown>,
        projectIds: data.projectIds,
      });

      return created(customer);

    } catch (error) {
      console.error('Failed to create customer:', error);
      return serverError('Failed to create customer');
    }
  }
);
