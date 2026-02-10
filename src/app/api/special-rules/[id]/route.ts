/**
 * /api/special-rules/:id
 *
 * Individual special rule management.
 *
 * GET    - Get special rule details
 * PATCH  - Update special rule
 * DELETE - Soft delete special rule
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { hasCustomerScope } from '@/lib/auth/context';
import { logSpecialRuleUpdate, logSpecialRuleDelete } from '@/lib/audit';
import {
  validateBody,
  updateSpecialRuleSchema,
  validationError,
  success,
  serverError,
  notFound,
  forbidden,
  badRequest,
  noContent,
} from '@/lib/utils';

/**
 * GET /api/special-rules/:id
 *
 * Get special rule details including effect history.
 * Requires special_rules:read permission and customer scope (if customer-specific).
 */
export const GET = withPermission(
  { resource: 'special_rules', action: 'read' },
  async (request, context): Promise<NextResponse> => {
    try {
      const ruleId = context.params.id;

      // Fetch rule with relations
      const rule = await prisma.specialRule.findUnique({
        where: { id: ruleId, deletedAt: null },
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
          effectLedgerEntries: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: {
              invoiceRun: {
                select: {
                  id: true,
                  billingMonth: true,
                  status: true,
                },
              },
            },
          },
        },
      });

      if (!rule) {
        return notFound('Special rule not found');
      }

      // Check access: global rules need super_admin, customer rules need scope
      if (rule.customerId) {
        if (!hasCustomerScope(context.auth, rule.customerId)) {
          return forbidden('Access denied to this special rule');
        }
      } else {
        // Global rule
        if (!context.auth.isSuperAdmin) {
          return forbidden('Only super_admin can access global special rules');
        }
      }

      // Transform effect history
      const effectHistory = rule.effectLedgerEntries.map((entry) => ({
        id: entry.id,
        invoiceRun: entry.invoiceRun,
        affectedRowCount: entry.affectedRowCount,
        costDelta: entry.costDelta.toString(),
        summary: entry.summary,
        createdAt: entry.createdAt,
      }));

      return success({
        id: rule.id,
        customerId: rule.customerId,
        customer: rule.customer,
        isGlobal: rule.customerId === null,
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
        effectHistory,
      });

    } catch (error) {
      console.error('Failed to get special rule:', error);
      return serverError('Failed to retrieve special rule');
    }
  }
);

/**
 * PATCH /api/special-rules/:id
 *
 * Update special rule properties.
 * Requires special_rules:write permission and customer scope (if customer-specific).
 */
export const PATCH = withPermission(
  { resource: 'special_rules', action: 'write' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const ruleId = context.params.id;

      // Fetch existing rule
      const existingRule = await prisma.specialRule.findUnique({
        where: { id: ruleId, deletedAt: null },
      });

      if (!existingRule) {
        return notFound('Special rule not found');
      }

      // Check access: global rules need super_admin, customer rules need scope
      if (existingRule.customerId) {
        if (!hasCustomerScope(context.auth, existingRule.customerId)) {
          return forbidden('Access denied to this special rule');
        }
      } else {
        if (!context.auth.isSuperAdmin) {
          return forbidden('Only super_admin can modify global special rules');
        }
      }

      // Validate request body
      const validation = await validateBody(request, updateSpecialRuleSchema);
      if (!validation.success) {
        return validationError(validation.error);
      }

      const data = validation.data;

      // Validate target customer if being changed
      if (data.targetCustomerId !== undefined && data.targetCustomerId !== null) {
        const targetCustomer = await prisma.customer.findUnique({
          where: { id: data.targetCustomerId },
        });
        if (!targetCustomer) {
          return badRequest('Target customer not found');
        }
      }

      // Validate SKU group if being changed
      if (data.matchSkuGroupId !== undefined && data.matchSkuGroupId !== null) {
        const skuGroup = await prisma.skuGroup.findUnique({
          where: { id: data.matchSkuGroupId },
        });
        if (!skuGroup) {
          return badRequest('SKU group not found');
        }
      }

      // Build update object
      const updateData: Record<string, unknown> = {};
      const beforeData: Record<string, unknown> = {};
      const afterData: Record<string, unknown> = {};

      const updateableFields = [
        'name', 'enabled', 'priority',
        'matchSkuId', 'matchSkuGroupId', 'matchServiceId',
        'matchProjectId', 'matchBillingAccountId',
        'costMultiplier', 'targetCustomerId',
        'effectiveStart', 'effectiveEnd',
      ];

      for (const field of updateableFields) {
        if (data[field as keyof typeof data] !== undefined) {
          const newValue = data[field as keyof typeof data];

          // Handle date fields
          if ((field === 'effectiveStart' || field === 'effectiveEnd') && newValue) {
            updateData[field] = new Date(newValue as string);
          } else {
            updateData[field] = newValue;
          }

          // Track changes for audit
          const oldValue = existingRule[field as keyof typeof existingRule];
          beforeData[field] = oldValue instanceof Date
            ? oldValue.toISOString().split('T')[0]
            : oldValue?.toString() ?? null;
          afterData[field] = newValue;
        }
      }

      // Nothing to update
      if (Object.keys(updateData).length === 0) {
        return success({
          id: existingRule.id,
          message: 'No changes made',
        });
      }

      // Update rule
      const updatedRule = await prisma.specialRule.update({
        where: { id: ruleId },
        data: updateData,
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
      });

      // Audit log
      await logSpecialRuleUpdate(context, ruleId, beforeData, afterData);

      return success({
        id: updatedRule.id,
        customerId: updatedRule.customerId,
        customer: updatedRule.customer,
        isGlobal: updatedRule.customerId === null,
        name: updatedRule.name,
        enabled: updatedRule.enabled,
        priority: updatedRule.priority,
        ruleType: updatedRule.ruleType,
        matchSkuId: updatedRule.matchSkuId,
        matchSkuGroup: updatedRule.matchSkuGroup,
        matchServiceId: updatedRule.matchServiceId,
        matchProjectId: updatedRule.matchProjectId,
        matchBillingAccountId: updatedRule.matchBillingAccountId,
        costMultiplier: updatedRule.costMultiplier?.toString() ?? null,
        targetCustomer: updatedRule.targetCustomer,
        effectiveStart: updatedRule.effectiveStart?.toISOString().split('T')[0] ?? null,
        effectiveEnd: updatedRule.effectiveEnd?.toISOString().split('T')[0] ?? null,
        updatedAt: updatedRule.updatedAt,
      });

    } catch (error) {
      console.error('Failed to update special rule:', error);
      return serverError('Failed to update special rule');
    }
  }
);

/**
 * DELETE /api/special-rules/:id
 *
 * Soft delete a special rule.
 * Requires special_rules:write permission and customer scope (if customer-specific).
 */
export const DELETE = withPermission(
  { resource: 'special_rules', action: 'write' },
  async (request, context): Promise<NextResponse> => {
    try {
      const ruleId = context.params.id;

      // Fetch existing rule
      const existingRule = await prisma.specialRule.findUnique({
        where: { id: ruleId, deletedAt: null },
      });

      if (!existingRule) {
        return notFound('Special rule not found');
      }

      // Check access: global rules need super_admin, customer rules need scope
      if (existingRule.customerId) {
        if (!hasCustomerScope(context.auth, existingRule.customerId)) {
          return forbidden('Access denied to this special rule');
        }
      } else {
        if (!context.auth.isSuperAdmin) {
          return forbidden('Only super_admin can delete global special rules');
        }
      }

      // Soft delete
      await prisma.specialRule.update({
        where: { id: ruleId },
        data: { deletedAt: new Date() },
      });

      // Audit log
      await logSpecialRuleDelete(context, ruleId, existingRule.name);

      return noContent();

    } catch (error) {
      console.error('Failed to delete special rule:', error);
      return serverError('Failed to delete special rule');
    }
  }
);
