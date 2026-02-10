/**
 * /api/dashboard/providers (Phase 7 - Analytics Dashboard)
 *
 * GET - Get provider breakdown
 *
 * Query params:
 * - month: YYYY-MM (optional, defaults to current month)
 *
 * Scope rules:
 * - super_admin: all data
 * - finance: all financial data
 * - normal user: only scoped customers (limited view)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/middleware';
import { getProviderBreakdown, AnalyticsScope } from '@/lib/analytics/queries';
import { getCustomerScopes } from '@/lib/auth/context';
import { success, serverError, badRequest } from '@/lib/utils';

/**
 * GET /api/dashboard/providers
 *
 * Returns provider breakdown including:
 * - Provider name
 * - Total cost
 * - Total revenue
 * - Margin amount and percentage
 * - Customer count
 * - Invoice count
 */
export const GET = withPermission(
  { resource: 'dashboard', action: 'read' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);
      const month = searchParams.get('month') || undefined;

      // Validate month format
      if (month && !/^\d{4}-\d{2}$/.test(month)) {
        return badRequest('Invalid month format. Use YYYY-MM');
      }

      // Build scope based on user permissions
      const scope: AnalyticsScope = {};

      // Check if user has restricted access
      const hasFinanceRole = context.auth.roles.includes('finance');
      if (!context.auth.isSuperAdmin && !hasFinanceRole) {
        // Provider breakdown is aggregated data - restricted users get empty results
        // This prevents exposing company-wide provider costs to limited users
        const scopedCustomers = getCustomerScopes(context.auth);
        if (scopedCustomers.length === 0) {
          return success({ data: [] });
        }
        // For scoped users, they can't see provider-level aggregates (privacy)
        return success({
          data: [],
          message: 'Provider breakdown not available for scoped access',
        });
      }

      const providers = await getProviderBreakdown(month, scope);

      return success({ data: providers });
    } catch (error) {
      console.error('Failed to get provider breakdown:', error);
      return serverError('Failed to get provider breakdown');
    }
  }
);
