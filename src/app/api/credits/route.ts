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
import {
  success,
  created,
  serverError,
  validationError,
  notFound,
} from '@/lib/utils';
import { z } from 'zod';

const createCreditSchema = z.object({
  customerId: z.string().uuid(),
  type: z.enum(['PROMOTIONAL', 'COMMITMENT', 'GOODWILL', 'REFUND']),
  totalAmount: z.number().positive(),
  description: z.string().optional(),
  validFrom: z.string(), // Date string YYYY-MM-DD
  validTo: z.string(), // Date string YYYY-MM-DD
  billingAccountId: z.string().optional(),
  currency: z.string().length(3).optional().default('USD'),
  allowCarryOver: z.boolean().optional().default(false),
  sourceReference: z.string().optional(),
});

/**
 * GET /api/credits
 *
 * List all credits with pagination and filters.
 */
export const GET = withPermission(
  { resource: 'customers', action: 'read' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);

      // Parse filters
      const customerId = searchParams.get('customerId');
      const type = searchParams.get('type');
      const status = searchParams.get('status');
      const page = parseInt(searchParams.get('page') || '1', 10);
      const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
      const skip = (page - 1) * limit;

      // Build where clause
      const where: Prisma.CreditWhereInput = {};

      if (customerId) {
        where.customerId = customerId;
      }
      if (type && ['PROMOTIONAL', 'COMMITMENT', 'GOODWILL', 'REFUND'].includes(type)) {
        where.type = type as CreditType;
      }
      if (status && ['ACTIVE', 'EXHAUSTED', 'EXPIRED', 'CANCELLED'].includes(status)) {
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
              select: {
                id: true,
                name: true,
                externalId: true,
              },
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
        type: credit.type,
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
  { resource: 'customers', action: 'update' },
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

      // Create credit
      const credit = await prisma.credit.create({
        data: {
          customerId: data.customerId,
          type: data.type as CreditType,
          totalAmount: data.totalAmount,
          remainingAmount: data.totalAmount, // Initially, remaining = total
          currency: data.currency || 'USD',
          validFrom,
          validTo,
          description: data.description,
          billingAccountId: data.billingAccountId,
          allowCarryOver: data.allowCarryOver ?? false,
          sourceReference: data.sourceReference,
          status: CreditStatus.ACTIVE,
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              externalId: true,
            },
          },
        },
      });

      // Audit log
      await logCreate(context, 'credits', credit.id, {
        customerId: credit.customerId,
        customerName: credit.customer.name,
        type: credit.type,
        totalAmount: credit.totalAmount.toString(),
        validFrom: credit.validFrom,
        validTo: credit.validTo,
      });

      return created({
        id: credit.id,
        customerId: credit.customerId,
        customer: credit.customer,
        type: credit.type,
        totalAmount: credit.totalAmount.toString(),
        remainingAmount: credit.remainingAmount.toString(),
        currency: credit.currency,
        validFrom: credit.validFrom,
        validTo: credit.validTo,
        status: credit.status,
        isActive: true,
        description: credit.description,
        createdAt: credit.createdAt,
      });
    } catch (error) {
      console.error('Failed to create credit:', error);
      return serverError('Failed to create credit');
    }
  }
);
