/**
 * /api/billing/monthly-lines/export
 *
 * Export historical GCP billing detail rows using the customer billing Excel
 * template structure.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/middleware';
import { badRequest, serverError } from '@/lib/utils';
import {
  buildBillingTemplateRowsForMonth,
  generateXLSXContent,
} from '@/lib/invoice-presentation/exporters/xlsx';
import { generateContentHash } from '@/lib/invoice-presentation/builder';

export const GET = withPermission(
  { resource: 'raw_cost', action: 'list' },
  async (request: NextRequest): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);
      const billingMonth = searchParams.get('billingMonth');
      const customerId = searchParams.get('customerId') || undefined;

      if (!billingMonth || !/^\d{4}-\d{2}$/.test(billingMonth)) {
        return badRequest('billingMonth is required in YYYY-MM format');
      }

      const result = await buildBillingTemplateRowsForMonth({
        billingMonth,
        customerId,
        page: 1,
        limit: 5000,
      });
      const content = generateXLSXContent(result.rows);
      const hash = generateContentHash(content);
      const filename = `billing-${billingMonth}${customerId ? `-${customerId}` : ''}.xlsx`;

      const headers = new Headers();
      headers.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      headers.set('Content-Disposition', `attachment; filename="${filename}"`);
      headers.set('Content-Length', content.length.toString());
      headers.set('X-Content-Hash', hash);
      headers.set('X-Row-Count', result.total.toString());

      return new NextResponse(new Uint8Array(content), { status: 200, headers });
    } catch (error) {
      console.error('Failed to export monthly billing lines:', error);
      return serverError('Failed to export monthly billing lines');
    }
  }
);
