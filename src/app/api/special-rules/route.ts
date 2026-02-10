/**
 * /api/special-rules
 *
 * Global special rules management (super_admin only).
 * Global rules have customerId = null and apply to all customers.
 *
 * GET  - List global special rules
 * POST - Create a new global special rule
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logSpecialRuleCreate } from '@/lib/audit';
import {
  validateBody,
  createSpecialRuleSchema,
  paginationSchema,
  validationError,
  success,
  created,
  serverError,
  forbidden,
  badRequest,
} from '@/lib/utils';

/**
 * GET /api/special-rules
 *
 * List all special rules.
 * Requires customers:read permission.
 */
export const GET = withPermission(
  { resource: 'customers', action: 'read' },
  async (request, context): Promise<NextResponse> => {
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

      // Filter options
      const enabledParam = searchParams.get('enabled');
      const ruleTypeParam = searchParams.get('ruleType');
      const customerIdParam = searchParams.get('customerId');

      const where = {
        deletedAt: null, // Exclude soft-deleted rules
        ...(customerIdParam ? { customerId: customerIdParam } : {}),
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
            customer: {
              select: {
                id: true,
                name: true,
              },
            },
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

      // Transform response - match what the page expects
      const data = rules.map((rule) => ({
        id: rule.id,
        customerId: rule.customerId,
        customer: rule.customer,
        name: rule.name,
        enabled: rule.enabled,
        isActive: rule.enabled, // Alias for compatibility
        priority: rule.priority,
        ruleType: rule.ruleType,
        config: {
          matchSkuId: rule.matchSkuId,
          matchSkuGroupId: rule.matchSkuGroupId,
          matchServiceId: rule.matchServiceId,
          matchProjectId: rule.matchProjectId,
          matchBillingAccountId: rule.matchBillingAccountId,
          costMultiplier: rule.costMultiplier?.toString() ?? null,
          targetCustomerId: rule.targetCustomerId,
        },
        matchSkuId: rule.matchSkuId,
        matchSkuGroup: rule.matchSkuGroup,
        matchServiceId: rule.matchServiceId,
        matchProjectId: rule.matchProjectId,
        matchBillingAccountId: rule.matchBillingAccountId,
        costMultiplier: rule.costMultiplier?.toString() ?? null,
        targetCustomer: rule.targetCustomer,
        effectiveFrom: rule.effectiveStart?.toISOString() ?? null,
        effectiveTo: rule.effectiveEnd?.toISOString() ?? null,
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
      console.error('Failed to list global special rules:', error);
      return serverError('Failed to retrieve special rules');
    }
  }
);

/**
 * POST /api/special-rules
 *
 * Create a new global special rule.
 * Requires special_rules:write permission and super_admin role.
 */
export const POST = withPermission(
  { resource: 'special_rules', action: 'write' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      // Only super_admin can create global rules
      if (!context.auth.isSuperAdmin) {
        return forbidden('Only super_admin can create global special rules');
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

      // Create global special rule (customerId = null)
      const rule = await prisma.specialRule.create({
        data: {
          customerId: null, // Global rule
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
      await logSpecialRuleCreate(context, rule.id, null, {
        name: rule.name,
        ruleType: rule.ruleType,
        priority: rule.priority,
        isGlobal: true,
        matchSkuId: rule.matchSkuId,
        matchSkuGroupId: rule.matchSkuGroupId,
        matchServiceId: rule.matchServiceId,
        costMultiplier: rule.costMultiplier?.toString(),
        targetCustomerId: rule.targetCustomerId,
      });

      return created({
        id: rule.id,
        customerId: null,
        isGlobal: true,
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
      console.error('Failed to create global special rule:', error);
      return serverError('Failed to create special rule');
    }
  }
);
