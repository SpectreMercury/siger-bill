/**
 * /api/billing/monthly-lines
 *
 * Browse historical GCP billing detail rows in the customer billing template
 * structure. This is read-only and does not require creating an invoice run.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PricingBasis } from '@prisma/client';
import { withPermission } from '@/lib/middleware';
import { getCustomerScopes, hasCustomerScope } from '@/lib/auth/context';
import { badRequest, forbidden, serverError, success } from '@/lib/utils';
import {
  buildBillingTemplateRowsForMonth,
  MonthlyBillingCustomerSelectionError,
  MonthlyBillingOverrideBasisMismatchError,
  MixedMonthlyBillingTemplateError,
} from '@/lib/invoice-presentation/exporters/xlsx';

export const GET = withPermission(
  { resource: 'raw_cost', action: 'list' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);
      const billingMonth = searchParams.get('billingMonth');
      const customerId = searchParams.get('customerId') || undefined;
      const priceBasisParam = searchParams.get('priceBasis');
      const page = Number(searchParams.get('page') || '1');
      const limit = Number(searchParams.get('limit') || '50');

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

      const result = await buildBillingTemplateRowsForMonth({
        billingMonth,
        priceBasis: priceBasis ?? undefined,
        customerId,
        customerIds,
        page,
        limit,
      });

      return success({
        headers: result.headers,
        rows: result.rows.slice(1),
        activeOverride: result.activeOverride ?? null,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      });
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
      console.error('Failed to load monthly billing lines:', error);
      return serverError('Failed to load monthly billing lines');
    }
  }
);
