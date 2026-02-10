/**
 * /api/dashboard/trends (Phase 7 - Analytics Dashboard)
 *
 * GET - Get revenue trends over time
 *
 * Query params:
 * - groupBy: 'month' | 'quarter' (optional, defaults to 'month')
 * - startMonth: YYYY-MM (optional)
 * - endMonth: YYYY-MM (optional)
 *
 * Scope rules:
 * - super_admin: all data
 * - finance: all financial data
 * - normal user: only scoped customers
 */

import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/middleware';
import { getRevenueTrends, AnalyticsScope } from '@/lib/analytics/queries';
import { getCustomerScopes } from '@/lib/auth/context';
import { success, serverError, badRequest } from '@/lib/utils';

/**
 * GET /api/dashboard/trends
 *
 * Returns time-series data for revenue trends including:
 * - Total revenue per period
 * - Total discount per period
 * - Total credits per period
 * - Customer count per period
 * - Invoice count per period
 */
export const GET = withPermission(
  { resource: 'dashboard', action: 'read' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);
      const groupBy = (searchParams.get('groupBy') as 'month' | 'quarter') || 'month';
      const startMonth = searchParams.get('startMonth') || undefined;
      const endMonth = searchParams.get('endMonth') || undefined;

      // Validate groupBy
      if (!['month', 'quarter'].includes(groupBy)) {
        return badRequest('Invalid groupBy value. Use "month" or "quarter"');
      }

      // Validate month formats
      if (startMonth && !/^\d{4}-\d{2}$/.test(startMonth)) {
        return badRequest('Invalid startMonth format. Use YYYY-MM');
      }
      if (endMonth && !/^\d{4}-\d{2}$/.test(endMonth)) {
        return badRequest('Invalid endMonth format. Use YYYY-MM');
      }

      // Build scope based on user permissions
      const scope: AnalyticsScope = {
        startMonth,
        endMonth,
      };

      // Check if user has restricted access
      const hasFinanceRole = context.auth.roles.includes('finance');
      if (!context.auth.isSuperAdmin && !hasFinanceRole) {
        const scopedCustomers = getCustomerScopes(context.auth);
        if (scopedCustomers.length > 0) {
          scope.customerIds = scopedCustomers;
        } else {
          return success({ data: [] });
        }
      }

      const trends = await getRevenueTrends(groupBy, scope);

      return success({ data: trends });
    } catch (error) {
      console.error('Failed to get revenue trends:', error);
      return serverError('Failed to get revenue trends');
    }
  }
);
