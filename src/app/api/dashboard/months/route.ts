/**
 * /api/dashboard/months (Phase 7 - Analytics Dashboard)
 *
 * GET - Get available months with analytics data
 *
 * This endpoint returns a list of months that have analytics data,
 * useful for populating month selectors in the dashboard UI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/middleware';
import { getAvailableMonths } from '@/lib/analytics/queries';
import { success, serverError } from '@/lib/utils';

/**
 * GET /api/dashboard/months
 *
 * Returns list of available months with data, sorted descending (most recent first)
 */
export const GET = withPermission(
  { resource: 'dashboard', action: 'read' },
  async (_request: NextRequest, _context): Promise<NextResponse> => {
    try {
      const months = await getAvailableMonths();

      return success({ data: months });
    } catch (error) {
      console.error('Failed to get available months:', error);
      return serverError('Failed to get available months');
    }
  }
);
