/**
 * /api/customers/[id]
 *
 * Single customer management endpoints.
 *
 * GET    - Get customer details
 * PUT    - Update customer
 * DELETE - Deactivate customer
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission, ExtendedRequestContext } from '@/lib/middleware';
import { verifyScopedCustomer } from '@/lib/auth/context';
import { logUpdate, logDelete } from '@/lib/audit';
import {
  validateBody,
  updateCustomerSchema,
  success,
  notFound,
  forbidden,
  serverError,
} from '@/lib/utils';

/**
 * GET /api/customers/[id]
 *
 * Get a single customer's details.
 */
export const GET = withPermission(
  { resource: 'customers', action: 'read' },
  async (_request: NextRequest, context: ExtendedRequestContext): Promise<NextResponse> => {
    try {
      const id = context.params.id;

      // Check scope access
      if (!verifyScopedCustomer(context.auth, id)) {
        return forbidden('Access denied to this customer');
      }

      const customer = await prisma.customer.findUnique({
        where: { id },
        include: {
          _count: {
            select: {
              customerProjects: true,
              invoices: true,
              credits: true,
              specialRules: true,
            },
          },
        },
      });

      if (!customer) {
        return notFound('Customer not found');
      }

      return success({
        ...customer,
        isActive: customer.status === 'ACTIVE',
      });

    } catch (error) {
      console.error('Failed to get customer:', error);
      return serverError('Failed to retrieve customer');
    }
  }
);

/**
 * PUT /api/customers/[id]
 *
 * Update a customer.
 */
export const PUT = withPermission(
  { resource: 'customers', action: 'update' },
  async (request: NextRequest, context: ExtendedRequestContext): Promise<NextResponse> => {
    try {
      const id = context.params.id;

      // Check scope access
      if (!verifyScopedCustomer(context.auth, id)) {
        return forbidden('Access denied to this customer');
      }

      // Validate request body
      const validation = await validateBody(request, updateCustomerSchema);
      if (!validation.success) {
        return NextResponse.json(
          { error: 'Validation failed', details: validation.error.flatten() },
          { status: 400 }
        );
      }

      const existing = await prisma.customer.findUnique({
        where: { id },
      });

      if (!existing) {
        return notFound('Customer not found');
      }

      const customer = await prisma.customer.update({
        where: { id },
        data: validation.data,
      });

      // Audit log
      await logUpdate(context, 'customers', id, existing as unknown as Record<string, unknown>, customer as unknown as Record<string, unknown>);

      return success(customer);

    } catch (error) {
      console.error('Failed to update customer:', error);
      return serverError('Failed to update customer');
    }
  }
);

/**
 * DELETE /api/customers/[id]
 *
 * Deactivate a customer (soft delete).
 */
export const DELETE = withPermission(
  { resource: 'customers', action: 'delete' },
  async (_request: NextRequest, context: ExtendedRequestContext): Promise<NextResponse> => {
    try {
      const id = context.params.id;

      // Check scope access
      if (!verifyScopedCustomer(context.auth, id)) {
        return forbidden('Access denied to this customer');
      }

      const existing = await prisma.customer.findUnique({
        where: { id },
      });

      if (!existing) {
        return notFound('Customer not found');
      }

      // Soft delete - set status to SUSPENDED
      await prisma.customer.update({
        where: { id },
        data: { status: 'SUSPENDED' },
      });

      // Audit log
      await logDelete(context, 'customers', id, existing as unknown as Record<string, unknown>);

      return success({ message: 'Customer deactivated' });

    } catch (error) {
      console.error('Failed to delete customer:', error);
      return serverError('Failed to delete customer');
    }
  }
);
