/**
 * /api/credits
 *
 * Credit management endpoints.
 *
 * GET  - List all credits
 * POST - Create a new credit
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logCreate } from '@/lib/audit';
import { CreditType, CreditStatus, Prisma } from '@prisma/client';
import { CREDIT_TYPES, createCreditSchema as baseCreateCreditSchema } from '@/lib/utils/validation';
import {
  success,
  created,
  serverError,
  validationError,
  notFound,
} from '@/lib/utils';
import { z } from 'zod';

const createCreditSchema = baseCreateCreditSchema.extend({
  customerId: z.string().uuid(),
});

/**
 * GET /api/credits
 *
 * List all credits with pagination and filters.
 */
export const GET = withPermission(
  { resource: 'credits', action: 'read' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);

      // Parse filters
      const customerId = searchParams.get('customerId');
      // `type` query param accepts comma-separated values → match any
      const typeParam = searchParams.get('type');
      const status = searchParams.get('status');
      const page = parseInt(searchParams.get('page') || '1', 10);
      const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
      const skip = (page - 1) * limit;

      // Build where clause
      const where: Prisma.CreditWhereInput = {};

      if (customerId) {
        where.customerId = customerId;
      }
      if (typeParam) {
        const requested = typeParam
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is (typeof CREDIT_TYPES)[number] =>
            (CREDIT_TYPES as readonly string[]).includes(s)
          );
        if (requested.length > 0) {
          where.types = { hasSome: requested as CreditType[] };
        }
      }
      if (status && ['ACTIVE', 'EXPIRED', 'DEPLETED'].includes(status)) {
        where.status = status as CreditStatus;
      }

      // Get credits with customer info
      const [credits, total] = await Promise.all([
        prisma.credit.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            customer: {
              select: { id: true, name: true, externalId: true },
            },
            matchSkuGroup: {
              select: { id: true, code: true, name: true },
            },
          },
        }),
        prisma.credit.count({ where }),
      ]);

      // Transform response
      const data = credits.map((credit) => ({
        id: credit.id,
        customerId: credit.customerId,
        customer: credit.customer,
        types: credit.types,
        totalAmount: credit.totalAmount.toString(),
        remainingAmount: credit.remainingAmount.toString(),
        currency: credit.currency,
        validFrom: credit.validFrom,
        validTo: credit.validTo,
        status: credit.status,
        isActive: credit.status === 'ACTIVE',
        description: credit.description,
        sourceReference: credit.sourceReference,
        allowCarryOver: credit.allowCarryOver,
        matchSkuId: credit.matchSkuId,
        matchSkuGroup: credit.matchSkuGroup,
        matchProjectId: credit.matchProjectId,
        createdAt: credit.createdAt,
        updatedAt: credit.updatedAt,
      }));

      return success({
        data,
        pagination: {
          page,
          pageSize: limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error('Failed to list credits:', error);
      return serverError('Failed to retrieve credits');
    }
  }
);

/**
 * POST /api/credits
 *
 * Create a new credit.
 */
export const POST = withPermission(
  { resource: 'credits', action: 'create' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const body = await request.json();
      const validation = createCreditSchema.safeParse(body);

      if (!validation.success) {
        return validationError(validation.error);
      }

      const data = validation.data;

      // Verify customer exists
      const customer = await prisma.customer.findUnique({
        where: { id: data.customerId },
      });

      if (!customer) {
        return notFound('Customer not found');
      }

      // Validate date range
      const validFrom = new Date(data.validFrom);
      const validTo = new Date(data.validTo);
      if (validFrom > validTo) {
        return serverError('Valid from date must be before valid to date');
      }

      // Validate SkuGroup if provided
      if (data.matchSkuGroupId) {
        const grp = await prisma.skuGroup.findUnique({ where: { id: data.matchSkuGroupId } });
        if (!grp) return notFound('SKU group');
      }

      // Create credit
      const credit = await prisma.credit.create({
        data: {
          customerId: data.customerId,
          types: data.types as CreditType[],
          totalAmount: data.totalAmount,
          remainingAmount: data.totalAmount,
          currency: data.currency || 'USD',
          validFrom,
          validTo,
          description: data.description,
          billingAccountId: data.billingAccountId,
          allowCarryOver: data.allowCarryOver ?? false,
          sourceReference: data.sourceReference,
          status: CreditStatus.ACTIVE,
          matchSkuId: data.matchSkuId ?? null,
          matchSkuGroupId: data.matchSkuGroupId ?? null,
          matchProjectId: data.matchProjectId ?? null,
        },
        include: {
          customer: { select: { id: true, name: true, externalId: true } },
          matchSkuGroup: { select: { id: true, code: true, name: true } },
        },
      });

      // Audit log
      await logCreate(context, 'credits', credit.id, {
        customerId: credit.customerId,
        customerName: credit.customer.name,
        types: credit.types,
        totalAmount: credit.totalAmount.toString(),
        validFrom: credit.validFrom,
        validTo: credit.validTo,
        matchSkuId: credit.matchSkuId,
        matchSkuGroupId: credit.matchSkuGroupId,
        matchProjectId: credit.matchProjectId,
      });

      return created({
        id: credit.id,
        customerId: credit.customerId,
        customer: credit.customer,
        types: credit.types,
        totalAmount: credit.totalAmount.toString(),
        remainingAmount: credit.remainingAmount.toString(),
        currency: credit.currency,
        validFrom: credit.validFrom,
        validTo: credit.validTo,
        status: credit.status,
        isActive: true,
        description: credit.description,
        matchSkuId: credit.matchSkuId,
        matchSkuGroup: credit.matchSkuGroup,
        matchProjectId: credit.matchProjectId,
        createdAt: credit.createdAt,
      });
    } catch (error) {
      console.error('Failed to create credit:', error);
      return serverError('Failed to create credit');
    }
  }
);
