/**
 * /api/dashboard/overview (Phase 7 - Analytics Dashboard)
 *
 * GET - Get dashboard overview KPIs
 *
 * Query params:
 * - month: YYYY-MM (optional, defaults to current month)
 *
 * Scope rules:
 * - super_admin: all data
 * - finance: all financial data
 * - normal user: only scoped customers
 */

import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/middleware';
import { getDashboardOverview, AnalyticsScope } from '@/lib/analytics/queries';
import { getCustomerScopes } from '@/lib/auth/context';
import { success, serverError, badRequest } from '@/lib/utils';

/**
 * GET /api/dashboard/overview
 *
 * Returns dashboard KPIs including:
 * - Total revenue
 * - Total customers
 * - Total invoices
 * - Average revenue per customer
 * - Month-over-month growth
 * - Top products
 * - Provider mix
 */
export const GET = withPermission(
  { resource: 'dashboard', action: 'read' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);
      const month = searchParams.get('month') || undefined;

      // Validate month format if provided
      if (month && !/^\d{4}-\d{2}$/.test(month)) {
        return badRequest('Invalid month format. Use YYYY-MM');
      }

      // Build scope based on user permissions
      const scope: AnalyticsScope = {};

      // Check if user has restricted access (not super_admin or finance role)
      const hasFinanceRole = context.auth.roles.includes('finance');
      if (!context.auth.isSuperAdmin && !hasFinanceRole) {
        // Get user's scoped customer IDs from their permissions
        const scopedCustomers = getCustomerScopes(context.auth);
        if (scopedCustomers.length > 0) {
          scope.customerIds = scopedCustomers;
        } else {
          // User has no customer access - return empty data
          return success({
            currentMonth: month || new Date().toISOString().slice(0, 7),
            totalRevenue: '0',
            totalCustomers: 0,
            totalInvoices: 0,
            avgRevenuePerCustomer: '0.00',
            momGrowth: '0.00',
            topProducts: [],
            providerMix: [],
          });
        }
      }

      const overview = await getDashboardOverview(month, scope);

      return success(overview);
    } catch (error) {
      console.error('Failed to get dashboard overview:', error);
      return serverError('Failed to get dashboard overview');
    }
  }
);
