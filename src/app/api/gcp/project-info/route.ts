/**
 * GET /api/gcp/project-info?projectId={projectId}
 *
 * Proxy to GCP Cloud Resource Manager API v1.
 * Fetches project display name and project number by GCP project ID.
 *
 * Auth: uses shared GCP auth module (service account > bearer token > API key).
 *
 * GCP ref: https://cloud.google.com/resource-manager/reference/rest/v1/projects/get
 */

import { NextRequest, NextResponse } from 'next/server';
import { withPermission } from '@/lib/middleware';
import { success, badRequest, notFound, serverError } from '@/lib/utils';
import { gcpFetchHeaders, withApiKey, hasGcpAuth, resolveGcpConnectionForUser } from '@/lib/gcp/auth';

interface GcpProjectResponse {
  name: string;
  projectNumber: string;
  projectId: string;
  lifecycleState: string;
}

export const GET = withPermission(
  { resource: 'projects', action: 'read' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId')?.trim();

    if (!projectId) {
      return badRequest('projectId query parameter is required');
    }

    if (!await hasGcpAuth()) {
      return serverError('No GCP credentials configured (set GCP_SERVICE_ACCOUNT_JSON, GCP_ACCESS_TOKEN, or GCP_API_KEY)');
    }

    // Resource Manager API — try Bearer auth first, fall back to API key
    const connectionId = await resolveGcpConnectionForUser(context.auth);
    const headers = await gcpFetchHeaders(connectionId);

    let gcpUrl = `https://cloudresourcemanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`;
    if (!headers) {
      // No OAuth — try API key
      gcpUrl = withApiKey(gcpUrl);
    }

    let res: Response;
    try {
      res = await fetch(gcpUrl, {
        headers: headers ?? { Accept: 'application/json' },
        cache: 'no-store',
      });
    } catch (err) {
      console.error('GCP Resource Manager network error:', err);
      return serverError('Failed to reach GCP API');
    }

    if (res.status === 404) {
      return notFound(`GCP project '${projectId}' not found`);
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`GCP Resource Manager error ${res.status}:`, errBody);
      return serverError(`GCP API returned ${res.status}`);
    }

    const data: GcpProjectResponse = await res.json();
    return success({
      projectId: data.projectId,
      name: data.name,
      projectNumber: data.projectNumber,
      lifecycleState: data.lifecycleState,
    });
  }
);
