/**
 * GET /api/gcp/billing-accounts/:id/projects
 *
 * Proxy → GET https://cloudbilling.googleapis.com/v1/billingAccounts/{id}/projects
 *
 * Lists all GCP projects linked to a billing account.
 * Returns projectId, billingEnabled status for each project.
 *
 * GCP ref: https://cloud.google.com/billing/docs/reference/rest/v1/billingAccounts.projects/list
 */

import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/middleware';
import { success, serverError } from '@/lib/utils';
import { gcpFetchHeaders, hasGcpAuth, resolveGcpConnectionForUser } from '@/lib/gcp/auth';

const GCP_BASE = 'https://cloudbilling.googleapis.com/v1';

interface GcpProjectBillingInfo {
  name: string;             // "projects/my-project/billingInfo"
  projectId: string;
  billingAccountName: string;
  billingEnabled: boolean;
}

interface GcpProjectsResponse {
  projectBillingInfo?: GcpProjectBillingInfo[];
  nextPageToken?: string;
}

export const GET = withPermission(
  { resource: 'projects', action: 'list' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    const { id } = context.params;
    const { searchParams } = new URL(request.url);
    const pageToken = searchParams.get('pageToken');
    const pageSize = searchParams.get('pageSize') ?? '100';

    if (!await hasGcpAuth()) {
      return serverError('No GCP credentials configured');
    }

    const connectionId = await resolveGcpConnectionForUser(context.auth);
    const headers = await gcpFetchHeaders(connectionId);
    if (!headers) return serverError('Failed to obtain GCP access token');

    let url = `${GCP_BASE}/billingAccounts/${encodeURIComponent(id)}/projects?pageSize=${pageSize}`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

    let res: Response;
    try {
      res = await fetch(url, { headers, cache: 'no-store' });
    } catch (err) {
      console.error('GCP billing account projects network error:', err);
      return serverError('Failed to reach GCP API');
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`GCP projects error ${res.status}:`, errBody);
      return serverError(`GCP API returned ${res.status}`);
    }

    const data: GcpProjectsResponse = await res.json();

    const projects = (data.projectBillingInfo ?? []).map((p) => ({
      projectId: p.projectId,
      billingEnabled: p.billingEnabled,
      // billingAccountName format: "billingAccounts/012345-567890-ABCDEF"
      billingAccountId: p.billingAccountName.replace('billingAccounts/', ''),
    }));

    return success({
      data: projects,
      nextPageToken: data.nextPageToken ?? null,
    });
  }
);
