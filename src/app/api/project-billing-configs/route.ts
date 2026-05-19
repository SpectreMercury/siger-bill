/**
 * /api/project-billing-configs
 *
 * Per (project_id × customer) billing configuration: stores whether a project
 * is billable for a particular customer, plus operator audit fields.
 *
 * GET  - List configs (filter by customerId / projectId, paginated)
 * POST - Create a new config
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logCreate } from '@/lib/audit';
import {
  paginationSchema,
  validateBody,
  validationError,
  success,
  created,
  serverError,
  conflict,
  notFound,
} from '@/lib/utils';

const createSchema = z.object({
  projectId: z.string().trim().min(1).max(100),
  customerId: z.string().uuid(),
  billable: z.boolean().default(true),
});

const operatorSelect = { id: true, firstName: true, lastName: true, email: true } as const;
const customerSelect = { id: true, name: true, externalId: true } as const;

function mapConfig(c: {
  id: string;
  projectId: string;
  billable: boolean;
  createdAt: Date;
  updatedAt: Date;
  customer: { id: string; name: string; externalId: string | null };
  creator: { id: string; firstName: string; lastName: string; email: string } | null;
  updater: { id: string; firstName: string; lastName: string; email: string } | null;
}) {
  return {
    id: c.id,
    projectId: c.projectId,
    billable: c.billable,
    customer: c.customer,
    createdBy: c.creator,
    updatedBy: c.updater,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export const GET = withPermission(
  { resource: 'project_billing_configs', action: 'list' },
  async (request: NextRequest): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);
      const pagination = paginationSchema.safeParse({
        page: searchParams.get('page'),
        limit: searchParams.get('limit'),
      });
      const page = pagination.success ? pagination.data.page : 1;
      const limit = pagination.success ? pagination.data.limit : 50;
      const skip = (page - 1) * limit;

      const where: Record<string, unknown> = {};
      const customerId = searchParams.get('customerId');
      const projectId = searchParams.get('projectId');
      const search = searchParams.get('search');
      if (customerId) where.customerId = customerId;
      if (projectId) where.projectId = projectId;
      if (search) {
        where.OR = [
          { projectId: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const [rows, total] = await Promise.all([
        prisma.projectBillingConfig.findMany({
          where,
          skip,
          take: limit,
          orderBy: { updatedAt: 'desc' },
          include: {
            customer: { select: customerSelect },
            creator: { select: operatorSelect },
            updater: { select: operatorSelect },
          },
        }),
        prisma.projectBillingConfig.count({ where }),
      ]);

      return success({
        data: rows.map(mapConfig),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (error) {
      console.error('Failed to list project billing configs:', error);
      return serverError('Failed to retrieve configs');
    }
  }
);

export const POST = withPermission(
  { resource: 'project_billing_configs', action: 'create' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const validation = await validateBody(request, createSchema);
      if (!validation.success) return validationError(validation.error);
      const { projectId, customerId, billable } = validation.data;

      const customer = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!customer) return notFound('Customer');

      const existing = await prisma.projectBillingConfig.findUnique({
        where: { projectId_customerId: { projectId, customerId } },
      });
      if (existing) {
        return conflict(
          `Config already exists for project "${projectId}" and this customer`,
          { existingId: existing.id }
        );
      }

      const row = await prisma.projectBillingConfig.create({
        data: {
          projectId,
          customerId,
          billable,
          createdBy: context.auth.userId,
          updatedBy: context.auth.userId,
        },
        include: {
          customer: { select: customerSelect },
          creator: { select: operatorSelect },
          updater: { select: operatorSelect },
        },
      });

      await logCreate(context, 'project_billing_configs', row.id, {
        projectId,
        customerId,
        customerName: customer.name,
        billable,
      });

      return created({ message: 'Config created', config: mapConfig(row) });
    } catch (error) {
      console.error('Failed to create project billing config:', error);
      return serverError('Failed to create config');
    }
  }
);
