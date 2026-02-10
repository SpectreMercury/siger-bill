/**
 * /api/billing-accounts
 *
 * GCP Billing Account management endpoints.
 * Billing accounts are the top-level entities that contain projects.
 *
 * GET  - List all billing accounts
 * POST - Create/register a new billing account
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logCreate } from '@/lib/audit';
import { BillingAccountStatus, Prisma } from '@prisma/client';
import {
  validateBody,
  createBillingAccountSchema,
  paginationSchema,
  validationError,
  success,
  created,
  serverError,
  conflict,
} from '@/lib/utils';

/**
 * GET /api/billing-accounts
 *
 * List all billing accounts with pagination.
 * Requires billing_accounts:list permission.
 *
 * Note: Billing accounts are global (not scoped to customers).
 * Projects under them are bound to customers via customer_projects.
 */
export const GET = withPermission(
  { resource: 'billing_accounts', action: 'list' },
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

      // Status filter
      const statusParam = searchParams.get('status');
      const status = statusParam === 'ACTIVE' ? BillingAccountStatus.ACTIVE
                   : statusParam === 'SUSPENDED' ? BillingAccountStatus.SUSPENDED
                   : undefined;

      const where: Prisma.BillingAccountWhereInput | undefined = status ? { status } : undefined;

      // Execute queries in parallel
      const [billingAccounts, total] = await Promise.all([
        prisma.billingAccount.findMany({
          where,
          skip,
          take: limit,
          orderBy: { billingAccountId: 'asc' },
          include: {
            _count: {
              select: { projects: true },
            },
          },
        }),
        prisma.billingAccount.count({ where }),
      ]);

      // Transform to include project count
      const data = billingAccounts.map((ba) => ({
        id: ba.id,
        billingAccountId: ba.billingAccountId,
        name: ba.name,
        status: ba.status,
        projectCount: ba._count.projects,
        createdAt: ba.createdAt,
        updatedAt: ba.updatedAt,
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
      console.error('Failed to list billing accounts:', error);
      return serverError('Failed to retrieve billing accounts');
    }
  }
);

/**
 * POST /api/billing-accounts
 *
 * Create/register a new GCP billing account.
 * Requires billing_accounts:create permission.
 */
export const POST = withPermission(
  { resource: 'billing_accounts', action: 'create' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      // Validate request body
      const validation = await validateBody(request, createBillingAccountSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const data = validation.data;

      // Check for duplicate
      const existing = await prisma.billingAccount.findUnique({
        where: { billingAccountId: data.billingAccountId },
      });
      if (existing) {
        return conflict(`Billing account '${data.billingAccountId}' already exists`);
      }

      // Create billing account
      const billingAccount = await prisma.billingAccount.create({
        data: {
          billingAccountId: data.billingAccountId,
          name: data.name,
        },
      });

      // Audit log
      await logCreate(
        context,
        'billing_accounts',
        billingAccount.id,
        billingAccount as unknown as Record<string, unknown>
      );

      return created(billingAccount);

    } catch (error) {
      console.error('Failed to create billing account:', error);
      return serverError('Failed to create billing account');
    }
  }
);
