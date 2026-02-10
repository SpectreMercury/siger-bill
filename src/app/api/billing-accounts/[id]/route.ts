/**
 * /api/billing-accounts/[id]
 *
 * Single billing account operations.
 *
 * GET    - Get billing account details with related projects
 * PUT    - Update billing account
 * DELETE - Delete billing account (only if no projects)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logUpdate, logDelete } from '@/lib/audit';
import { BillingAccountStatus } from '@prisma/client';
import {
  success,
  notFound,
  serverError,
  conflict,
  badRequest,
} from '@/lib/utils';

/**
 * GET /api/billing-accounts/[id]
 *
 * Get billing account details with related projects.
 */
export const GET = withPermission(
  { resource: 'billing_accounts', action: 'read' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id } = context.params;

      const billingAccount = await prisma.billingAccount.findUnique({
        where: { id },
        include: {
          projects: {
            include: {
              customerProjects: {
                where: { isActive: true },
                include: {
                  customer: {
                    select: {
                      id: true,
                      name: true,
                      externalId: true,
                    },
                  },
                },
              },
            },
            orderBy: { projectId: 'asc' },
          },
        },
      });

      if (!billingAccount) {
        return notFound('Billing account not found');
      }

      // Transform to include customer info
      const data = {
        id: billingAccount.id,
        billingAccountId: billingAccount.billingAccountId,
        name: billingAccount.name,
        status: billingAccount.status,
        createdAt: billingAccount.createdAt,
        updatedAt: billingAccount.updatedAt,
        projects: billingAccount.projects.map((project) => ({
          id: project.id,
          projectId: project.projectId,
          name: project.name,
          status: project.status,
          customers: project.customerProjects.map((cp) => ({
            id: cp.customer.id,
            name: cp.customer.name,
            externalId: cp.customer.externalId,
          })),
        })),
      };

      return success(data);
    } catch (error) {
      console.error('Failed to get billing account:', error);
      return serverError('Failed to retrieve billing account');
    }
  }
);

/**
 * PUT /api/billing-accounts/[id]
 *
 * Update billing account name or status.
 */
export const PUT = withPermission(
  { resource: 'billing_accounts', action: 'update' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id } = context.params;
      const body = await request.json();

      // Find existing
      const existing = await prisma.billingAccount.findUnique({
        where: { id },
      });

      if (!existing) {
        return notFound('Billing account not found');
      }

      // Validate status if provided
      const validStatuses = ['ACTIVE', 'SUSPENDED', 'UNKNOWN'];
      if (body.status && !validStatuses.includes(body.status)) {
        return badRequest(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
      }

      // Update
      const updated = await prisma.billingAccount.update({
        where: { id },
        data: {
          name: body.name !== undefined ? body.name : existing.name,
          status: body.status ? (body.status as BillingAccountStatus) : existing.status,
        },
      });

      // Audit log
      await logUpdate(
        context,
        'billing_accounts',
        id,
        existing as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>
      );

      return success(updated);
    } catch (error) {
      console.error('Failed to update billing account:', error);
      return serverError('Failed to update billing account');
    }
  }
);

/**
 * DELETE /api/billing-accounts/[id]
 *
 * Delete a billing account. Only allowed if no projects are associated.
 */
export const DELETE = withPermission(
  { resource: 'billing_accounts', action: 'delete' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { id } = context.params;

      // Find existing with project count
      const existing = await prisma.billingAccount.findUnique({
        where: { id },
        include: {
          _count: {
            select: { projects: true },
          },
        },
      });

      if (!existing) {
        return notFound('Billing account not found');
      }

      // Check for associated projects
      if (existing._count.projects > 0) {
        return conflict(
          `Cannot delete billing account with ${existing._count.projects} associated project(s). Remove projects first.`
        );
      }

      // Delete
      await prisma.billingAccount.delete({
        where: { id },
      });

      // Audit log
      await logDelete(
        context,
        'billing_accounts',
        id,
        existing as unknown as Record<string, unknown>
      );

      return success({ deleted: true });
    } catch (error) {
      console.error('Failed to delete billing account:', error);
      return serverError('Failed to delete billing account');
    }
  }
);
