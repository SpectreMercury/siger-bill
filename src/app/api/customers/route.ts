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

      // Execute queries in parallel
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
          },
        }),
        prisma.customer.count({ where }),
      ]);

      return success({
        data: customers,
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

      // Create customer
      const customer = await prisma.customer.create({
        data: {
          name: data.name,
          externalId: data.externalId,
          billingAccountId: data.billingAccountId,
          domain: data.domain,
          currency: data.currency,
          paymentTermsDays: data.paymentTermsDays,
          primaryContactName: data.primaryContactName,
          primaryContactEmail: data.primaryContactEmail,
        },
      });

      // Audit log
      await logCreate(context, 'customers', customer.id, customer as unknown as Record<string, unknown>);

      return created(customer);

    } catch (error) {
      console.error('Failed to create customer:', error);
      return serverError('Failed to create customer');
    }
  }
);
