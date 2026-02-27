/**
 * GET /api/gcp/billing-accounts/:id
 *
 * Proxy → GET https://cloudbilling.googleapis.com/v1/billingAccounts/{id}
 *
 * Retrieves a single Cloud Billing account by its ID.
 *
 * GCP ref: https://cloud.google.com/billing/docs/reference/rest/v1/billingAccounts/get
 */

import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/middleware';
import { success, notFound, serverError } from '@/lib/utils';
import { gcpFetchHeaders, hasGcpAuth, resolveGcpConnectionForUser } from '@/lib/gcp/auth';

const GCP_BASE = 'https://cloudbilling.googleapis.com/v1';

export const GET = withPermission(
  { resource: 'billing_accounts', action: 'read' },
  async (_request: NextRequest, context): Promise<NextResponse> => {
    const { id } = context.params;

    if (!await hasGcpAuth()) {
      return serverError('No GCP credentials configured');
    }

    const connectionId = await resolveGcpConnectionForUser(context.auth);
    const headers = await gcpFetchHeaders(connectionId);
    if (!headers) return serverError('Failed to obtain GCP access token');

    const url = `${GCP_BASE}/billingAccounts/${encodeURIComponent(id)}`;

    let res: Response;
    try {
      res = await fetch(url, { headers, cache: 'no-store' });
    } catch (err) {
      console.error('GCP get billing account error:', err);
      return serverError('Failed to reach GCP API');
    }

    if (res.status === 404) return notFound(`Billing account '${id}' not found in GCP`);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`GCP billing account error ${res.status}:`, errBody);
      return serverError(`GCP API returned ${res.status}`);
    }

    const data = await res.json();
    return success({
      billingAccountId: data.name.replace('billingAccounts/', ''),
      displayName: data.displayName,
      open: data.open,
      masterBillingAccount: data.masterBillingAccount ?? null,
    });
  }
);
