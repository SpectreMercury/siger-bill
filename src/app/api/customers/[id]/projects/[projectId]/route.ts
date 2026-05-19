/**
 * /api/customers/:id/projects/:projectId
 *
 * DELETE - Unbind a single project from this customer.
 *          The projectId is the GCP project string (varchar), matching
 *          CustomerProject.projectId in the new binding model.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermissionAndScope } from '@/lib/middleware';
import { logAuditEvent } from '@/lib/audit';
import { AuditAction } from '@prisma/client';
import { success, serverError, notFound } from '@/lib/utils';

export const DELETE = withPermissionAndScope(
  { resource: 'customer_projects', action: 'unbind' },
  (_request, routeParams) => routeParams?.params.id ?? null,
  async (_request: NextRequest, context): Promise<NextResponse> => {
    try {
      const customerId = context.params.id as string;
      const projectId = context.params.projectId as string;

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, name: true },
      });
      if (!customer) {
        return notFound('Customer not found');
      }

      const binding = await prisma.customerProject.findFirst({
        where: { customerId, projectId, isActive: true },
        select: { id: true, projectId: true, startDate: true, endDate: true },
      });
      if (!binding) {
        return notFound(`No active binding for project '${projectId}' on this customer`);
      }

      await prisma.customerProject.delete({ where: { id: binding.id } });

      await logAuditEvent(context, {
        action: AuditAction.UNBIND,
        targetTable: 'customer_projects',
        targetId: binding.id,
        beforeData: {
          customerId,
          customerName: customer.name,
          projectId: binding.projectId,
          startDate: binding.startDate,
          endDate: binding.endDate,
        },
      });

      return success({ deleted: true, projectId: binding.projectId });
    } catch (error) {
      console.error('Failed to unbind project from customer:', error);
      return serverError('Failed to unbind project from customer');
    }
  }
);
