/**
 * /api/customers/:id/special-rules
 *
 * Customer-specific special rules management.
 * Special rules are applied BEFORE pricing and credits during invoice runs.
 *
 * GET  - List special rules for this customer
 * POST - Create a new special rule for this customer
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermissionAndScope } from '@/lib/middleware';
import { logSpecialRuleCreate } from '@/lib/audit';
import {
  validateBody,
  createSpecialRuleSchema,
  paginationSchema,
  validationError,
  success,
  created,
  serverError,
  notFound,
  badRequest,
} from '@/lib/utils';

/**
 * GET /api/customers/:id/special-rules
 *
 * List all special rules for this customer.
 * Requires special_rules:read permission and customer scope.
 */
export const GET = withPermissionAndScope(
  { resource: 'special_rules', action: 'read' },
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

      // Filter options
      const enabledParam = searchParams.get('enabled');
      const ruleTypeParam = searchParams.get('ruleType');

      const where = {
        customerId,
        deletedAt: null, // Exclude soft-deleted rules
        ...(enabledParam !== null ? { enabled: enabledParam === 'true' } : {}),
        ...(ruleTypeParam ? { ruleType: ruleTypeParam as 'EXCLUDE_SKU' | 'EXCLUDE_SKU_GROUP' | 'OVERRIDE_COST' | 'MOVE_TO_CUSTOMER' } : {}),
      };

      // Execute queries in parallel
      const [rules, total] = await Promise.all([
        prisma.specialRule.findMany({
          where,
          skip,
          take: limit,
          orderBy: { priority: 'asc' },
          include: {
            matchSkuGroup: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
            targetCustomer: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        }),
        prisma.specialRule.count({ where }),
      ]);

      // Transform response
      const data = rules.map((rule) => ({
        id: rule.id,
        customerId: rule.customerId,
        name: rule.name,
        enabled: rule.enabled,
        priority: rule.priority,
        ruleType: rule.ruleType,
        matchSkuId: rule.matchSkuId,
        matchSkuGroup: rule.matchSkuGroup,
        matchServiceId: rule.matchServiceId,
        matchProjectId: rule.matchProjectId,
        matchBillingAccountId: rule.matchBillingAccountId,
        costMultiplier: rule.costMultiplier?.toString() ?? null,
        targetCustomer: rule.targetCustomer,
        effectiveStart: rule.effectiveStart?.toISOString().split('T')[0] ?? null,
        effectiveEnd: rule.effectiveEnd?.toISOString().split('T')[0] ?? null,
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
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
      console.error('Failed to list customer special rules:', error);
      return serverError('Failed to retrieve special rules');
    }
  }
);

/**
 * POST /api/customers/:id/special-rules
 *
 * Create a new special rule for this customer.
 * Requires special_rules:write permission and customer scope.
 */
export const POST = withPermissionAndScope(
  { resource: 'special_rules', action: 'write' },
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
      const validation = await validateBody(request, createSpecialRuleSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const data = validation.data;

      // Validate rule-specific requirements
      if (data.ruleType === 'OVERRIDE_COST' && data.costMultiplier === undefined) {
        return badRequest('costMultiplier is required for OVERRIDE_COST rule type');
      }
      if (data.ruleType === 'MOVE_TO_CUSTOMER' && !data.targetCustomerId) {
        return badRequest('targetCustomerId is required for MOVE_TO_CUSTOMER rule type');
      }
      if ((data.ruleType === 'EXCLUDE_SKU_GROUP' || data.ruleType === 'OVERRIDE_COST') &&
          !data.matchSkuId && !data.matchSkuGroupId && !data.matchServiceId) {
        return badRequest('At least one match condition (matchSkuId, matchSkuGroupId, or matchServiceId) is required');
      }

      // Validate target customer exists for MOVE_TO_CUSTOMER
      if (data.targetCustomerId) {
        const targetCustomer = await prisma.customer.findUnique({
          where: { id: data.targetCustomerId },
        });
        if (!targetCustomer) {
          return badRequest('Target customer not found');
        }
      }

      // Validate SKU group exists if specified
      if (data.matchSkuGroupId) {
        const skuGroup = await prisma.skuGroup.findUnique({
          where: { id: data.matchSkuGroupId },
        });
        if (!skuGroup) {
          return badRequest('SKU group not found');
        }
      }

      // Create special rule
      const rule = await prisma.specialRule.create({
        data: {
          customerId,
          name: data.name,
          enabled: data.enabled,
          priority: data.priority,
          ruleType: data.ruleType,
          matchSkuId: data.matchSkuId || null,
          matchSkuGroupId: data.matchSkuGroupId || null,
          matchServiceId: data.matchServiceId || null,
          matchProjectId: data.matchProjectId || null,
          matchBillingAccountId: data.matchBillingAccountId || null,
          costMultiplier: data.costMultiplier ?? null,
          targetCustomerId: data.targetCustomerId || null,
          effectiveStart: data.effectiveStart ? new Date(data.effectiveStart) : null,
          effectiveEnd: data.effectiveEnd ? new Date(data.effectiveEnd) : null,
        },
        include: {
          matchSkuGroup: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          targetCustomer: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Audit log
      await logSpecialRuleCreate(context, rule.id, customerId, {
        name: rule.name,
        ruleType: rule.ruleType,
        priority: rule.priority,
        matchSkuId: rule.matchSkuId,
        matchSkuGroupId: rule.matchSkuGroupId,
        matchServiceId: rule.matchServiceId,
        costMultiplier: rule.costMultiplier?.toString(),
        targetCustomerId: rule.targetCustomerId,
      });

      return created({
        id: rule.id,
        customerId: rule.customerId,
        name: rule.name,
        enabled: rule.enabled,
        priority: rule.priority,
        ruleType: rule.ruleType,
        matchSkuId: rule.matchSkuId,
        matchSkuGroup: rule.matchSkuGroup,
        matchServiceId: rule.matchServiceId,
        matchProjectId: rule.matchProjectId,
        matchBillingAccountId: rule.matchBillingAccountId,
        costMultiplier: rule.costMultiplier?.toString() ?? null,
        targetCustomer: rule.targetCustomer,
        effectiveStart: rule.effectiveStart?.toISOString().split('T')[0] ?? null,
        effectiveEnd: rule.effectiveEnd?.toISOString().split('T')[0] ?? null,
        createdAt: rule.createdAt,
      });

    } catch (error) {
      console.error('Failed to create special rule:', error);
      return serverError('Failed to create special rule');
    }
  }
);
