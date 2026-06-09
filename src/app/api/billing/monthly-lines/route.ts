/**
 * /api/billing/monthly-lines
 *
 * Browse historical GCP billing detail rows in the customer billing template
 * structure. This is read-only and does not require creating an invoice run.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/middleware';
import { badRequest, serverError, success } from '@/lib/utils';
import {
  TEMPLATE_HEADERS,
  buildBillingTemplateRowsForMonth,
} from '@/lib/invoice-presentation/exporters/xlsx';

export const GET = withPermission(
  { resource: 'raw_cost', action: 'list' },
  async (request: NextRequest): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);
      const billingMonth = searchParams.get('billingMonth');
      const customerId = searchParams.get('customerId') || undefined;
      const page = Number(searchParams.get('page') || '1');
      const limit = Number(searchParams.get('limit') || '50');

      if (!billingMonth || !/^\d{4}-\d{2}$/.test(billingMonth)) {
        return badRequest('billingMonth is required in YYYY-MM format');
      }

      const result = await buildBillingTemplateRowsForMonth({
        billingMonth,
        customerId,
        page,
        limit,
      });

      return success({
        headers: TEMPLATE_HEADERS,
        rows: result.rows.slice(1),
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      });
    } catch (error) {
      console.error('Failed to load monthly billing lines:', error);
      return serverError('Failed to load monthly billing lines');
    }
  }
);
