/**
 * GET /api/gcp/projects/:projectId/billing-info
 *
 * Proxy → GET https://cloudbilling.googleapis.com/v1/projects/{projectId}/billingInfo
 *
 * Returns the billing account associated with a GCP project and whether billing is enabled.
 *
 * GCP ref: https://cloud.google.com/billing/docs/reference/rest/v1/projects/getBillingInfo
 */

import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/middleware';
import { success, notFound, serverError } from '@/lib/utils';
import { gcpFetchHeaders, hasGcpAuth } from '@/lib/gcp/auth';

const GCP_BASE = 'https://cloudbilling.googleapis.com/v1';

export const GET = withPermission(
  { resource: 'projects', action: 'read' },
  async (_request: NextRequest, context): Promise<NextResponse> => {
    const { projectId } = context.params;

    if (!hasGcpAuth()) {
      return serverError('No GCP credentials configured');
    }

    const headers = await gcpFetchHeaders();
    if (!headers) return serverError('Failed to obtain GCP access token');

    const url = `${GCP_BASE}/projects/${encodeURIComponent(projectId)}/billingInfo`;

    let res: Response;
    try {
      res = await fetch(url, { headers, cache: 'no-store' });
    } catch (err) {
      console.error('GCP project billing info network error:', err);
      return serverError('Failed to reach GCP API');
    }

    if (res.status === 404) return notFound(`Project '${projectId}' not found in GCP`);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`GCP project billing info error ${res.status}:`, errBody);
      return serverError(`GCP API returned ${res.status}`);
    }

    const data = await res.json();
    return success({
      projectId: data.projectId,
      // "billingAccounts/012345-567890-ABCDEF" → "012345-567890-ABCDEF"
      billingAccountId: data.billingAccountName?.replace('billingAccounts/', '') ?? null,
      billingEnabled: data.billingEnabled ?? false,
    });
  }
);
