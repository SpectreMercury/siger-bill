/**
 * /api/dashboard/products (Phase 7 - Analytics Dashboard)
 *
 * GET - Get product group breakdown
 *
 * Query params:
 * - month: YYYY-MM (optional, defaults to current month)
 * - provider: string (optional, filter by provider)
 *
 * Scope rules:
 * - super_admin: all data
 * - finance: all financial data
 * - normal user: only scoped customers
 */

import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/middleware';
import { getProductBreakdown, AnalyticsScope } from '@/lib/analytics/queries';
import { getCustomerScopes } from '@/lib/auth/context';
import { success, serverError, badRequest } from '@/lib/utils';
import { BillingProvider } from '@prisma/client';

/**
 * GET /api/dashboard/products
 *
 * Returns product group breakdown including:
 * - Product group name
 * - List amount (before discounts)
 * - Discount amount
 * - Final amount
 * - Discount percentage
 * - Line item count
 * - Customer count
 */
export const GET = withPermission(
  { resource: 'dashboard', action: 'read' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);
      const month = searchParams.get('month') || undefined;
      const provider = searchParams.get('provider') as BillingProvider | null;

      // Validate month format
      if (month && !/^\d{4}-\d{2}$/.test(month)) {
        return badRequest('Invalid month format. Use YYYY-MM');
      }

      // Validate provider if provided
      const validProviders: BillingProvider[] = ['AWS', 'GCP', 'AZURE', 'OPENAI', 'CUSTOM'];
      if (provider && !validProviders.includes(provider)) {
        return badRequest(`Invalid provider. Must be one of: ${validProviders.join(', ')}`);
      }

      // Build scope based on user permissions
      const scope: AnalyticsScope = {};

      if (provider) {
        scope.provider = provider;
      }

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

      const products = await getProductBreakdown(month, scope);

      return success({ data: products });
    } catch (error) {
      console.error('Failed to get product breakdown:', error);
      return serverError('Failed to get product breakdown');
    }
  }
);
