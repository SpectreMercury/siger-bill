/**
 * /api/billing/monthly-lines/overrides
 *
 * Upload and inspect monthly billing Excel overrides.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/middleware';
import { hasCustomerScope } from '@/lib/auth/context';
import { logAuditEvent } from '@/lib/audit';
import { getBillingMonthLockReason } from '@/lib/billing/active-sources';
import { createBillingMonthlyOverride, findActiveBillingMonthlyOverride } from '@/lib/billing/monthly-overrides';
import { badRequest, conflict, forbidden, serverError, success } from '@/lib/utils';
import { AuditAction, Prisma } from '@prisma/client';

function isBillingMonth(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}$/.test(value);
}

export const GET = withPermission(
  { resource: 'raw_cost', action: 'read' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);
      const billingMonth = searchParams.get('billingMonth');
      const customerId = searchParams.get('customerId') || undefined;

      if (!isBillingMonth(billingMonth)) {
        return badRequest('billingMonth is required in YYYY-MM format');
      }
      if (customerId && !hasCustomerScope(context.auth, customerId)) {
        return forbidden('You do not have access to this customer');
      }
      if (!customerId && !context.auth.isSuperAdmin) {
        return forbidden('Select a customer to inspect a billing override');
      }

      const activeOverride = await findActiveBillingMonthlyOverride(billingMonth, customerId);
      return success({ activeOverride });
    } catch (error) {
      console.error('Failed to load monthly billing override:', error);
      return serverError('Failed to load monthly billing override');
    }
  }
);

export const POST = withPermission(
  { resource: 'raw_cost', action: 'import' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const formData = await request.formData();
      const billingMonth = formData.get('billingMonth');
      const customerIdValue = formData.get('customerId');
      const fileValue = formData.get('file');
      const priceBasisValue = formData.get('priceBasis');

      if (typeof billingMonth !== 'string' || !isBillingMonth(billingMonth)) {
        return badRequest('billingMonth is required in YYYY-MM format');
      }

      const customerId = typeof customerIdValue === 'string' && customerIdValue.trim()
        ? customerIdValue.trim()
        : undefined;
      const priceBasisValueString = typeof priceBasisValue === 'string' && priceBasisValue
        ? priceBasisValue
        : undefined;
      if (priceBasisValueString && priceBasisValueString !== 'STANDARD' && priceBasisValueString !== 'COST') {
        return badRequest('priceBasis must be STANDARD or COST');
      }
      const priceBasis = priceBasisValueString as 'STANDARD' | 'COST' | undefined;

      if (customerId && !hasCustomerScope(context.auth, customerId)) {
        return forbidden('You do not have access to this customer');
      }
      if (!customerId && !context.auth.isSuperAdmin) {
        return forbidden('Only super admins can upload month-wide billing overrides');
      }

      if (!(fileValue instanceof File)) {
        return badRequest('file is required');
      }
      if (!fileValue.name.endsWith('.xlsx')) {
        return badRequest('Only .xlsx files are supported');
      }

      const lockError = await getBillingMonthLockReason(billingMonth, customerId ? { customerId } : {});
      if (lockError) return conflict(lockError);

      const buffer = Buffer.from(await fileValue.arrayBuffer());
      const override = await createBillingMonthlyOverride({
        billingMonth,
        customerId,
        sourceFilename: fileValue.name,
        fileBuffer: buffer,
        uploadedBy: context.auth.userId,
        priceBasis,
      });

      await logAuditEvent(context, {
        action: AuditAction.IMPORT,
        targetTable: 'billing_monthly_overrides',
        targetId: override.id,
        afterData: {
          billingMonth,
          customerId: customerId ?? null,
          rowCount: override.rowCount,
          sourceFilename: override.sourceFilename,
          sourceFileHash: override.sourceFileHash,
          priceBasis: override.priceBasis,
        },
      });

      return success({
        message: 'Monthly billing override uploaded',
        activeOverride: override,
      });
    } catch (error) {
      console.error('Failed to upload monthly billing override:', error);
      const message = error instanceof Error ? error.message : 'Failed to upload monthly billing override';
      if (error instanceof Prisma.PrismaClientKnownRequestError) return serverError(message);
      return badRequest(message);
    }
  }
);
