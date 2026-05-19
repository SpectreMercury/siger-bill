/**
 * /api/project-billing-configs
 *
 * Project registry endpoints. Each row is a GCP project the reseller manages
 * (uniquely keyed by GCP projectId string), with business-side metadata:
 *   - name             (display label; preset options enforced at app layer,
 *                       see src/lib/constants/project-names.ts)
 *   - billable         (whether costs from this project roll up to invoices)
 *   - billingAccountId (FK to billing_accounts.id)
 *
 * Customer ↔ project binding is NOT stored here — see CustomerProject /
 * /api/customers/[id]/projects.
 *
 * GET  - List projects (?search=, ?billingAccountId=, paginated)
 * POST - Create a new project registry row
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
} from '@/lib/utils';

const createSchema = z.object({
  projectId: z.string().trim().min(1).max(100),
  name: z.string().trim().max(255).optional().nullable(),
  billable: z.boolean().default(true),
  billingAccountId: z.string().uuid().optional().nullable(),
});

const operatorSelect = { id: true, firstName: true, lastName: true, email: true } as const;
const billingAccountSelect = { id: true, billingAccountId: true, name: true } as const;

type ConfigRow = {
  id: string;
  projectId: string;
  name: string | null;
  billable: boolean;
  billingAccount: { id: string; billingAccountId: string; name: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
  creator: { id: string; firstName: string; lastName: string; email: string } | null;
  updater: { id: string; firstName: string; lastName: string; email: string } | null;
};

function mapConfig(c: ConfigRow) {
  return {
    id: c.id,
    projectId: c.projectId,
    name: c.name,
    billable: c.billable,
    billingAccount: c.billingAccount,
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
      const projectId = searchParams.get('projectId');
      const billingAccountId = searchParams.get('billingAccountId');
      const search = searchParams.get('search');
      // `customerIds` is comma-separated. Bridges through CustomerProject:
      // we resolve each customer's currently-active project bindings and
      // narrow PBC to projects bound to at least one of those customers.
      const customerIdsParam = searchParams.get('customerIds');

      if (projectId) where.projectId = projectId;
      if (billingAccountId) where.billingAccountId = billingAccountId;
      if (search) {
        where.OR = [
          { projectId: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ];
      }

      if (customerIdsParam) {
        const customerIds = customerIdsParam
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (customerIds.length > 0) {
          const bindings = await prisma.customerProject.findMany({
            where: { customerId: { in: customerIds }, isActive: true },
            select: { projectId: true },
          });
          const allowedProjectIds = Array.from(new Set(bindings.map((b) => b.projectId)));
          if (allowedProjectIds.length === 0) {
            // No bindings → empty result set without hitting PBC.
            return success({
              data: [],
              pagination: { page, limit, total: 0, totalPages: 0 },
            });
          }
          // Compose with any existing projectId filter (single id) safely.
          if (typeof where.projectId === 'string') {
            if (!allowedProjectIds.includes(where.projectId)) {
              return success({
                data: [],
                pagination: { page, limit, total: 0, totalPages: 0 },
              });
            }
          } else {
            where.projectId = { in: allowedProjectIds };
          }
        }
      }

      const [rows, total] = await Promise.all([
        prisma.projectBillingConfig.findMany({
          where,
          skip,
          take: limit,
          orderBy: { updatedAt: 'desc' },
          include: {
            billingAccount: { select: billingAccountSelect },
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
      const { projectId, name, billable, billingAccountId } = validation.data;

      const existing = await prisma.projectBillingConfig.findUnique({
        where: { projectId },
        select: { id: true },
      });
      if (existing) {
        return conflict(`Project '${projectId}' is already in the registry`, {
          existingId: existing.id,
        });
      }

      const row = await prisma.projectBillingConfig.create({
        data: {
          projectId,
          name: name ?? null,
          billable,
          billingAccountId: billingAccountId ?? null,
          createdBy: context.auth.userId,
          updatedBy: context.auth.userId,
        },
        include: {
          billingAccount: { select: billingAccountSelect },
          creator: { select: operatorSelect },
          updater: { select: operatorSelect },
        },
      });

      await logCreate(context, 'project_billing_configs', row.id, {
        projectId,
        name,
        billable,
        billingAccountId,
      });

      return created({ message: 'Project registered', config: mapConfig(row) });
    } catch (error) {
      console.error('Failed to create project billing config:', error);
      return serverError('Failed to create config');
    }
  }
);
