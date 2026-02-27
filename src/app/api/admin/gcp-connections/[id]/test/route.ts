/**
 * POST /api/admin/gcp-connections/:id/test
 *
 * Tests a GCP connection by calling GET /v1/billingAccounts.
 * Returns the list of billing accounts found (or an error message).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withAuthParams } from '@/lib/middleware';
import { success, notFound, serverError } from '@/lib/utils';
import { gcpFetchHeaders, ServiceAccountCreds, ApiKeyCreds } from '@/lib/gcp/auth';

function forbidden() {
  return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
}

export const POST = withAuthParams(async (_request: NextRequest, context): Promise<NextResponse> => {
  if (!context.auth.isSuperAdmin) return forbidden();
  const { id } = context.params;

  try {
    const conn = await prisma.gcpConnection.findUnique({ where: { id } });
    if (!conn) return notFound('GCP connection not found');

    // Quick sanity-check credentials before making the API call
    if (conn.authType === 'SERVICE_ACCOUNT') {
      const creds = conn.credentials as unknown as ServiceAccountCreds;
      if (!creds.client_email || !creds.private_key) {
        return success({
          ok: false,
          error: 'Incomplete SERVICE_ACCOUNT credentials (client_email or private_key missing)',
        });
      }
    }
    if (conn.authType === 'API_KEY') {
      const creds = conn.credentials as unknown as ApiKeyCreds;
      if (!creds.key) {
        return success({ ok: false, error: 'API key is empty' });
      }
    }

    const headers = await gcpFetchHeaders(id);
    if (!headers) {
      return success({ ok: false, error: 'Failed to obtain GCP access token from credentials' });
    }

    const gcpRes = await fetch(
      'https://cloudbilling.googleapis.com/v1/billingAccounts?pageSize=5',
      { headers, cache: 'no-store' }
    );

    if (!gcpRes.ok) {
      const errBody = await gcpRes.text().catch(() => '');
      return success({
        ok: false,
        statusCode: gcpRes.status,
        error: `GCP API returned ${gcpRes.status}: ${errBody.slice(0, 200)}`,
      });
    }

    const data = await gcpRes.json();
    const accounts: Array<{ billingAccountId: string; displayName: string }> = (
      data.billingAccounts ?? []
    ).map((a: { name: string; displayName: string }) => ({
      billingAccountId: a.name.replace('billingAccounts/', ''),
      displayName: a.displayName,
    }));

    return success({
      ok: true,
      message: `Connection successful. Found ${accounts.length} billing account(s).`,
      billingAccounts: accounts,
    });
  } catch (err) {
    console.error('GCP connection test failed:', err);
    return serverError('Connection test failed');
  }
});
