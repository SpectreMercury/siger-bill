/**
 * GET /api/gcp/billing-accounts
 *
 * Proxy → GET https://cloudbilling.googleapis.com/v1/billingAccounts
 *
 * Lists all Cloud Billing accounts accessible to the configured service account.
 * Requires billing:viewer role on the accounts.
 *
 * GCP ref: https://cloud.google.com/billing/docs/reference/rest/v1/billingAccounts/list
 */

import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/middleware';
import { success, serverError } from '@/lib/utils';
import { gcpFetchHeaders, hasGcpAuth, resolveGcpConnectionForUser } from '@/lib/gcp/auth';

const GCP_BASE = 'https://cloudbilling.googleapis.com/v1';

interface GcpBillingAccount {
  name: string;         // e.g. "billingAccounts/012345-567890-ABCDEF"
  open: boolean;
  displayName: string;
  masterBillingAccount?: string;
}

interface GcpBillingAccountsResponse {
  billingAccounts?: GcpBillingAccount[];
  nextPageToken?: string;
}

export const GET = withPermission(
  { resource: 'billing_accounts', action: 'list' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    if (!await hasGcpAuth()) {
      return serverError('No GCP credentials configured (set GCP_SERVICE_ACCOUNT_JSON or GCP_ACCESS_TOKEN)');
    }

    const { searchParams } = new URL(request.url);
    const pageToken = searchParams.get('pageToken');
    const pageSize = searchParams.get('pageSize') ?? '50';

    const connectionId = await resolveGcpConnectionForUser(context.auth);
    const headers = await gcpFetchHeaders(connectionId);
    if (!headers) {
      return serverError('Failed to obtain GCP access token');
    }

    let url = `${GCP_BASE}/billingAccounts?pageSize=${pageSize}`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

    let res: Response;
    try {
      res = await fetch(url, { headers, cache: 'no-store' });
    } catch (err) {
      console.error('GCP billing accounts network error:', err);
      return serverError('Failed to reach GCP API');
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`GCP billing accounts error ${res.status}:`, errBody);
      return serverError(`GCP API returned ${res.status}`);
    }

    const data: GcpBillingAccountsResponse = await res.json();

    const accounts = (data.billingAccounts ?? []).map((a) => ({
      // Extract the ID part from "billingAccounts/012345-567890-ABCDEF"
      billingAccountId: a.name.replace('billingAccounts/', ''),
      displayName: a.displayName,
      open: a.open,
      masterBillingAccount: a.masterBillingAccount ?? null,
    }));

    return success({
      data: accounts,
      nextPageToken: data.nextPageToken ?? null,
    });
  }
);
