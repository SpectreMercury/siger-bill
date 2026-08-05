/**
 * /api/billing/monthly-lines/export
 *
 * Export historical GCP billing detail rows using the customer billing Excel
 * template structure.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PricingBasis } from '@prisma/client';
import { withPermission } from '@/lib/middleware';
import { getCustomerScopes, hasCustomerScope } from '@/lib/auth/context';
import { badRequest, forbidden, serverError } from '@/lib/utils';
import {
  buildBillingTemplateRowsForMonth,
  generateXLSXContent,
  MonthlyBillingCustomerSelectionError,
  MonthlyBillingOverrideBasisMismatchError,
  MixedMonthlyBillingTemplateError,
} from '@/lib/invoice-presentation/exporters/xlsx';
import { generateContentHash } from '@/lib/invoice-presentation/builder';
import { prisma } from '@/lib/db';
import {
  buildMonthlyBillingExportContentDisposition,
  buildMonthlyBillingExportFilename,
} from '@/lib/billing/monthly-export';

export const GET = withPermission(
  { resource: 'raw_cost', action: 'list' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);
      const billingMonth = searchParams.get('billingMonth');
      const customerId = searchParams.get('customerId') || undefined;
      const priceBasisParam = searchParams.get('priceBasis');

      if (!billingMonth || !/^\d{4}-\d{2}$/.test(billingMonth)) {
        return badRequest('billingMonth is required in YYYY-MM format');
      }
      if (priceBasisParam && !['STANDARD', 'COST'].includes(priceBasisParam)) {
        return badRequest('priceBasis must be STANDARD or COST');
      }
      const priceBasis = priceBasisParam as PricingBasis | null;
      if (customerId && !hasCustomerScope(context.auth, customerId)) {
        return forbidden('You do not have access to this customer');
      }
      const customerIds = !customerId && !context.auth.isSuperAdmin
        ? getCustomerScopes(context.auth)
        : undefined;

      const [result, customer] = await Promise.all([
        buildBillingTemplateRowsForMonth({
          billingMonth,
          priceBasis: priceBasis ?? undefined,
          customerId,
          customerIds,
          all: true,
        }),
        customerId
          ? prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } })
          : Promise.resolve(null),
      ]);
      const content = generateXLSXContent(result.rows);
      const hash = generateContentHash(content);
      const filename = buildMonthlyBillingExportFilename(billingMonth, customer?.name);

      const headers = new Headers();
      headers.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      headers.set('Content-Disposition', buildMonthlyBillingExportContentDisposition(filename));
      headers.set('Content-Length', content.length.toString());
      headers.set('X-Content-Hash', hash);
      headers.set('X-Row-Count', result.total.toString());

      return new NextResponse(new Uint8Array(content), { status: 200, headers });
    } catch (error) {
      if (error instanceof MonthlyBillingCustomerSelectionError) {
        return badRequest('该月份存在全月 Override，请先选择单个客户');
      }
      if (error instanceof MixedMonthlyBillingTemplateError) {
        return badRequest('标准版和 Cost 版客户不能共用同一账单模板，请先选择单个客户');
      }
      if (error instanceof MonthlyBillingOverrideBasisMismatchError) {
        const stored = error.storedBasis === PricingBasis.STANDARD ? '列表价' : 'Cost';
        return badRequest(`当前 Override 是${stored}模板，请切换账单口径后重试`);
      }
      console.error('Failed to export monthly billing lines:', error);
      return serverError('Failed to export monthly billing lines');
    }
  }
);
