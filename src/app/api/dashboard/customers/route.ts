/**
 * /api/dashboard/customers (Phase 7 - Analytics Dashboard)
 *
 * GET - Get customer rankings by revenue
 *
 * Query params:
 * - month: YYYY-MM (optional, defaults to current month)
 * - limit: number (optional, defaults to 10)
 *
 * Scope rules:
 * - super_admin: all data
 * - finance: all financial data
 * - normal user: only scoped customers
 */

import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/middleware';
import { getCustomerRankings, AnalyticsScope } from '@/lib/analytics/queries';
import { getCustomerScopes } from '@/lib/auth/context';
import { success, serverError, badRequest } from '@/lib/utils';

/**
 * GET /api/dashboard/customers
 *
 * Returns customer rankings by revenue including:
 * - Customer ID and name
 * - Total revenue
 * - Month-over-month growth
 * - Invoice count
 * - Rank
 */
export const GET = withPermission(
  { resource: 'dashboard', action: 'read' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);
      const month = searchParams.get('month') || undefined;
      const limitParam = searchParams.get('limit');
      const limit = limitParam ? parseInt(limitParam, 10) : 10;

      // Validate month format
      if (month && !/^\d{4}-\d{2}$/.test(month)) {
        return badRequest('Invalid month format. Use YYYY-MM');
      }

      // Validate limit
      if (isNaN(limit) || limit < 1 || limit > 100) {
        return badRequest('Invalid limit. Must be between 1 and 100');
      }

      // Build scope based on user permissions
      const scope: AnalyticsScope = {};

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

      const customers = await getCustomerRankings(month, limit, scope);

      return success({ data: customers });
    } catch (error) {
      console.error('Failed to get customer rankings:', error);
      return serverError('Failed to get customer rankings');
    }
  }
);
