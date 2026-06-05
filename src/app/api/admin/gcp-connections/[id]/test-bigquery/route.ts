/**
 * POST /api/admin/gcp-connections/:id/test-bigquery
 *
 * Tests the configured BigQuery billing export table.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withAuthParams } from '@/lib/middleware';
import { success, notFound, serverError } from '@/lib/utils';
import { createGcpBigQueryAdapterFromConnection } from '@/lib/billing/adapters/gcp-bigquery';

function forbidden() {
  return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
}

export const POST = withAuthParams(async (_request: NextRequest, context): Promise<NextResponse> => {
  if (!context.auth.isSuperAdmin) return forbidden();
  const { id } = context.params;

  try {
    const conn = await prisma.gcpConnection.findUnique({ where: { id } });
    if (!conn) return notFound('GCP connection not found');

    const adapter = createGcpBigQueryAdapterFromConnection(conn);
    const isValid = await adapter.validateConnection();
    if (!isValid) {
      return success({
        ok: false,
        error:
          'BigQuery table validation failed. Check table project, dataset, table name, auth, and job project permissions.',
      });
    }

    const accounts = await adapter.listAccounts();

    return success({
      ok: true,
      message: `BigQuery connection successful. Found ${accounts.length} billing account(s).`,
      source: `${conn.billingProjectId}.${conn.billingDatasetId}.${conn.billingTableName}`,
      jobProjectId: conn.billingJobProjectId || conn.billingProjectId,
      accounts,
    });
  } catch (err) {
    console.error('GCP BigQuery connection test failed:', err);
    return serverError(err instanceof Error ? err.message : 'BigQuery connection test failed');
  }
});
