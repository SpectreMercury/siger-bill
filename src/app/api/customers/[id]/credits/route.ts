/**
 * /api/customers/:id/credits
 *
 * Customer credits management.
 * Credits can be applied to invoices to reduce amounts due.
 *
 * GET  - List credits for this customer
 * POST - Create a new credit for this customer
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermissionAndScope } from '@/lib/middleware';
import { logCreditCreate } from '@/lib/audit';
import {
  validateBody,
  createCreditSchema,
  paginationSchema,
  validationError,
  success,
  created,
  serverError,
  notFound,
  badRequest,
} from '@/lib/utils';

/**
 * GET /api/customers/:id/credits
 *
 * List all credits for this customer.
 * Requires credits:read permission and customer scope.
 */
export const GET = withPermissionAndScope(
  { resource: 'credits', action: 'read' },
  (_request, routeParams) => routeParams?.params.id ?? null,
  async (request, context): Promise<NextResponse> => {
    try {
      const customerId = context.params.id;
      const { searchParams } = new URL(request.url);

      // Verify customer exists
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
      });
      if (!customer) {
        return notFound('Customer not found');
      }

      // Parse pagination
      const pagination = paginationSchema.safeParse({
        page: searchParams.get('page'),
        limit: searchParams.get('limit'),
      });

      const page = pagination.success ? pagination.data.page : 1;
      const limit = pagination.success ? pagination.data.limit : 20;
      const skip = (page - 1) * limit;

      // Filter by status if provided
      const statusParam = searchParams.get('status');
      const status = statusParam as 'ACTIVE' | 'EXPIRED' | 'DEPLETED' | null;

      const where = {
        customerId,
        ...(status ? { status } : {}),
      };

      // Execute queries in parallel
      const [credits, total] = await Promise.all([
        prisma.credit.findMany({
          where,
          skip,
          take: limit,
          orderBy: { validFrom: 'asc' },
          select: {
            id: true,
            customerId: true,
            billingAccountId: true,
            type: true,
            totalAmount: true,
            remainingAmount: true,
            currency: true,
            validFrom: true,
            validTo: true,
            allowCarryOver: true,
            status: true,
            sourceReference: true,
            description: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: { ledgerEntries: true },
            },
          },
        }),
        prisma.credit.count({ where }),
      ]);

      // Transform response
      const data = credits.map((credit) => ({
        id: credit.id,
        customerId: credit.customerId,
        billingAccountId: credit.billingAccountId,
        type: credit.type,
        totalAmount: credit.totalAmount.toString(),
        remainingAmount: credit.remainingAmount.toString(),
        currency: credit.currency,
        validFrom: credit.validFrom.toISOString().split('T')[0],
        validTo: credit.validTo.toISOString().split('T')[0],
        allowCarryOver: credit.allowCarryOver,
        status: credit.status,
        sourceReference: credit.sourceReference,
        description: credit.description,
        applicationCount: credit._count.ledgerEntries,
        createdAt: credit.createdAt,
        updatedAt: credit.updatedAt,
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
      console.error('Failed to list customer credits:', error);
      return serverError('Failed to retrieve customer credits');
    }
  }
);

/**
 * POST /api/customers/:id/credits
 *
 * Create a new credit for this customer.
 * Requires credits:write permission and customer scope.
 */
export const POST = withPermissionAndScope(
  { resource: 'credits', action: 'write' },
  (_request, routeParams) => routeParams?.params.id ?? null,
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const customerId = context.params.id;

      // Verify customer exists
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
      });
      if (!customer) {
        return notFound('Customer not found');
      }

      // Validate request body
      const validation = await validateBody(request, createCreditSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const data = validation.data;

      // Validate date range
      const validFrom = new Date(data.validFrom);
      const validTo = new Date(data.validTo);
      if (validTo <= validFrom) {
        return badRequest('validTo must be after validFrom');
      }

      // Create credit
      const credit = await prisma.credit.create({
        data: {
          customerId,
          billingAccountId: data.billingAccountId || null,
          type: data.type,
          totalAmount: data.totalAmount,
          remainingAmount: data.totalAmount, // Initially full amount is remaining
          currency: data.currency,
          validFrom,
          validTo,
          allowCarryOver: data.allowCarryOver,
          status: 'ACTIVE',
          sourceReference: data.sourceReference || null,
          description: data.description || null,
        },
      });

      // Audit log
      await logCreditCreate(context, credit.id, customerId, {
        type: credit.type,
        totalAmount: credit.totalAmount.toString(),
        currency: credit.currency,
        validFrom: credit.validFrom.toISOString().split('T')[0],
        validTo: credit.validTo.toISOString().split('T')[0],
        allowCarryOver: credit.allowCarryOver,
        billingAccountId: credit.billingAccountId,
        sourceReference: credit.sourceReference,
      });

      return created({
        id: credit.id,
        customerId: credit.customerId,
        billingAccountId: credit.billingAccountId,
        type: credit.type,
        totalAmount: credit.totalAmount.toString(),
        remainingAmount: credit.remainingAmount.toString(),
        currency: credit.currency,
        validFrom: credit.validFrom.toISOString().split('T')[0],
        validTo: credit.validTo.toISOString().split('T')[0],
        allowCarryOver: credit.allowCarryOver,
        status: credit.status,
        sourceReference: credit.sourceReference,
        description: credit.description,
        createdAt: credit.createdAt,
      });

    } catch (error) {
      console.error('Failed to create credit:', error);
      return serverError('Failed to create credit');
    }
  }
);
