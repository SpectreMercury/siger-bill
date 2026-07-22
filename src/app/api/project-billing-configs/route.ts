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
import { Prisma, ProjectChargeType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getCustomerScopes, hasCustomerScope } from '@/lib/auth/context';
import { withPermission } from '@/lib/middleware';
import { logCreate } from '@/lib/audit';
import {
  chargeTypeToBillable,
  PROJECT_CHARGE_TYPES,
} from '@/lib/project-billing-configs/charge-type';
import {
  paginationSchema,
  validateBody,
  validationError,
  success,
  created,
  serverError,
  conflict,
  notFound,
  forbidden,
} from '@/lib/utils';

const createSchema = z.object({
  projectId: z.string().trim().min(1).max(100),
  name: z.string().trim().max(255).optional().nullable(),
  chargeType: z.enum(PROJECT_CHARGE_TYPES).optional(),
  billable: z.boolean().optional(),
  billingAccountId: z.string().uuid().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
});

const operatorSelect = { id: true, firstName: true, lastName: true, email: true } as const;
const billingAccountSelect = { id: true, billingAccountId: true, name: true } as const;

type ConfigRow = {
  id: string;
  projectId: string;
  name: string | null;
  billable: boolean;
  chargeType: ProjectChargeType;
  billingAccount: { id: string; billingAccountId: string; name: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
  creator: { id: string; firstName: string; lastName: string; email: string } | null;
  updater: { id: string; firstName: string; lastName: string; email: string } | null;
};

function mapConfig(
  c: ConfigRow,
  boundCustomers: Array<{
    customerId: string;
    customerName: string;
    startDate: Date | null;
    endDate: Date | null;
  }> = []
) {
  return {
    id: c.id,
    projectId: c.projectId,
    name: c.name,
    billable: c.billable,
    chargeType: c.chargeType,
    billingAccount: c.billingAccount,
    boundCustomers,
    createdBy: c.creator,
    updatedBy: c.updater,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export const GET = withPermission(
  { resource: 'project_billing_configs', action: 'list' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);
      const pagination = paginationSchema.safeParse({
        page: searchParams.get('page'),
        limit: searchParams.get('limit'),
      });
      const page = pagination.success ? pagination.data.page : 1;
      const limit = pagination.success ? pagination.data.limit : 50;
      const skip = (page - 1) * limit;

      const where: Prisma.ProjectBillingConfigWhereInput = {};
      const projectId = searchParams.get('projectId');
      const billingAccountId = searchParams.get('billingAccountId');
      const search = searchParams.get('search');
      const chargeType = searchParams.get('chargeType');
      // `customerIds` is comma-separated. Bridges through CustomerProject:
      // we resolve each customer's currently-active project bindings and
      // narrow PBC to projects bound to at least one of those customers.
      const customerIdsParam = searchParams.get('customerIds');

      if (projectId) where.projectId = projectId;
      if (billingAccountId) where.billingAccountId = billingAccountId;
      if (chargeType && PROJECT_CHARGE_TYPES.includes(chargeType as ProjectChargeType)) {
        where.chargeType = chargeType as ProjectChargeType;
      }
      if (search) {
        where.OR = [
          { projectId: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ];
      }

      const requestedCustomerIds = customerIdsParam
        ? customerIdsParam.split(',').map((value) => value.trim()).filter(Boolean)
        : [];
      if (
        !context.auth.isSuperAdmin
        && requestedCustomerIds.some((customerId) => !hasCustomerScope(context.auth, customerId))
      ) {
        return forbidden('You do not have access to one or more selected customers');
      }
      const scopedCustomerIds = context.auth.isSuperAdmin
        ? undefined
        : getCustomerScopes(context.auth);
      const effectiveCustomerIds = requestedCustomerIds.length > 0
        ? requestedCustomerIds
        : scopedCustomerIds;
      if (effectiveCustomerIds) {
        where.customerProjects = {
          some: {
            customerId: { in: effectiveCustomerIds },
            isActive: true,
          },
        };
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

      const projectIds = rows.map((r) => r.projectId);
      const bindings = projectIds.length === 0
        ? []
        : await prisma.customerProject.findMany({
            where: {
              projectId: { in: projectIds },
              isActive: true,
              ...(scopedCustomerIds ? { customerId: { in: scopedCustomerIds } } : {}),
            },
            select: {
              projectId: true,
              startDate: true,
              endDate: true,
              customer: { select: { id: true, name: true } },
            },
          });
      const bindingsByProject = new Map<string, Array<{
        customerId: string;
        customerName: string;
        startDate: Date | null;
        endDate: Date | null;
      }>>();
      for (const binding of bindings) {
        const values = bindingsByProject.get(binding.projectId) ?? [];
        values.push({
          customerId: binding.customer.id,
          customerName: binding.customer.name,
          startDate: binding.startDate,
          endDate: binding.endDate,
        });
        bindingsByProject.set(binding.projectId, values);
      }

      return success({
        data: rows.map((row) => mapConfig(row, bindingsByProject.get(row.projectId))),
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
      const { projectId, name, billingAccountId, customerId } = validation.data;
      const chargeType = validation.data.chargeType
        ?? (validation.data.billable === false
          ? ProjectChargeType.NON_BILLABLE
          : ProjectChargeType.BILLABLE);
      const billable = chargeTypeToBillable(chargeType);

      const existing = await prisma.projectBillingConfig.findUnique({
        where: { projectId },
        select: { id: true },
      });
      if (existing) {
        return conflict(`Project '${projectId}' is already in the registry`, {
          existingId: existing.id,
        });
      }

      const customer = customerId
        ? await prisma.customer.findUnique({
            where: { id: customerId },
            select: { id: true, name: true },
          })
        : null;
      if (customerId && !customer) return notFound('Customer');
      if (customer && !hasCustomerScope(context.auth, customer.id)) {
        return forbidden('You do not have access to this customer');
      }

      const billingAccount = billingAccountId
        ? await prisma.billingAccount.findUnique({
            where: { id: billingAccountId },
            select: { id: true },
          })
        : null;
      if (billingAccountId && !billingAccount) {
        return notFound('Billing account');
      }

      const row = await prisma.$transaction(async (tx) => {
        const createdRow = await tx.projectBillingConfig.create({
          data: {
            projectId,
            name: name ?? null,
            billable,
            chargeType,
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
        if (customer) {
          await tx.customerProject.create({
            data: {
              customerId: customer.id,
              projectId,
              isActive: true,
              startDate: new Date(),
            },
          });
        }
        return createdRow;
      });

      await logCreate(context, 'project_billing_configs', row.id, {
        projectId,
        name,
        billable,
        chargeType,
        billingAccountId,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
      });

      return created({
        message: 'Project registered',
        config: mapConfig(row, customer ? [{
          customerId: customer.id,
          customerName: customer.name,
          startDate: new Date(),
          endDate: null,
        }] : []),
      });
    } catch (error) {
      console.error('Failed to create project billing config:', error);
      return serverError('Failed to create config');
    }
  }
);
