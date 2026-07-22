import { prisma } from '@/lib/db';
import { createGcpBigQueryAdapterFromConnection } from '@/lib/billing/adapters/gcp-bigquery';
import { ingestFromAdapter } from '@/lib/billing/unified-engine';
import {
  findActiveBigQueryProjectOverlaps,
  getBillingMonthLockReason,
} from '@/lib/billing/active-sources';
import { getCustomerScopes, hasCustomerScope } from '@/lib/auth/context';
import { AuthContext } from '@/lib/types';
import { BillingProvider, BillingSourceType } from '@prisma/client';

const BILLING_ACTIVE_BATCH_REUSE_WINDOW_MS = Number(
  process.env.BILLING_ACTIVE_BATCH_REUSE_WINDOW_MS || 5 * 60 * 1_000
);

export type BigQueryBillingSyncInput = {
  billingMonth: string;
  connectionId?: string;
  customerId?: string;
  resolvedConnectionIds?: string[];
};

export type BigQueryBillingSyncResult = {
  message: string;
  billingMonth: string;
  batches: Array<{
    connectionId: string;
    connectionName: string;
    batchId: string;
    rowCount: number;
    reusedActiveBatch?: boolean;
  }>;
  totalRows: number;
  sourceConflictCount: number;
  sourceConflicts: Awaited<ReturnType<typeof findActiveBigQueryProjectOverlaps>>;
  errors?: string[];
};

type GcpBillingConnection = {
  id: string;
  name: string;
  billingProjectId: string | null;
  billingJobProjectId: string | null;
  billingDatasetId: string | null;
  billingTableName: string | null;
  billingAccountIds: string[];
  credentials: unknown;
  authType: string;
};

export class BigQueryBillingSyncError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'BigQueryBillingSyncError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function fail(message: string, status: number, code?: string, details?: Record<string, unknown>): never {
  throw new BigQueryBillingSyncError(message, status, code, details);
}

function buildBigQuerySourceKeyForConnection(conn: GcpBillingConnection): string | null {
  if (!conn.billingProjectId || !conn.billingDatasetId || !conn.billingTableName) return null;

  const source = `${conn.billingProjectId}.${conn.billingDatasetId}.${conn.billingTableName}`;
  const accountScope = conn.billingAccountIds.length > 0
    ? [...conn.billingAccountIds].sort().join(',')
    : '*';
  return `${source}|billingAccounts=${accountScope}`;
}

async function findReusableActiveBatchForConnection(
  conn: GcpBillingConnection,
  billingMonth: string
) {
  const sourceKey = buildBigQuerySourceKeyForConnection(conn);
  if (!sourceKey) return null;
  const reusableSince = new Date(
    Date.now() - Math.max(0, BILLING_ACTIVE_BATCH_REUSE_WINDOW_MS)
  );

  return prisma.billingIngestionBatch.findFirst({
    where: {
      provider: BillingProvider.GCP,
      sourceType: BillingSourceType.BIGQUERY_EXPORT,
      invoiceMonth: billingMonth,
      isActive: true,
      createdAt: { gte: reusableSince },
      sourceMetadata: {
        path: ['sourceKey'],
        equals: sourceKey,
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function resolveConnections(
  input: BigQueryBillingSyncInput,
  auth: AuthContext
): Promise<GcpBillingConnection[]> {
  const { connectionId, customerId } = input;
  if (input.resolvedConnectionIds !== undefined) {
    if (connectionId && !auth.isSuperAdmin) {
      fail('Only super admin can specify connectionId directly', 403, 'SCOPE_DENIED');
    }
    if (customerId && !hasCustomerScope(auth, customerId)) {
      fail('Access denied to this customer', 403, 'SCOPE_DENIED');
    }

    const resolvedConnectionIds = Array.from(new Set(input.resolvedConnectionIds));
    if (resolvedConnectionIds.length === 0) {
      fail('Billing sync job has no resolved GCP connections', 400, 'NO_BILLING_CONNECTIONS');
    }

    if (!auth.isSuperAdmin) {
      const scopedCustomers = await prisma.customer.findMany({
        where: {
          id: { in: getCustomerScopes(auth) },
          gcpConnectionId: { in: resolvedConnectionIds },
        },
        select: { gcpConnectionId: true },
      });
      const allowedConnectionIds = new Set(
        scopedCustomers.flatMap((customer) => customer.gcpConnectionId ?? [])
      );
      if (resolvedConnectionIds.some((id) => !allowedConnectionIds.has(id))) {
        fail('Access denied to one or more billing connections', 403, 'SCOPE_DENIED');
      }
    }

    const connections = await prisma.gcpConnection.findMany({
      where: { id: { in: resolvedConnectionIds }, isActive: true },
    });
    if (connections.length !== resolvedConnectionIds.length) {
      fail('One or more GCP billing connections are missing or inactive', 404, 'NOT_FOUND');
    }
    return connections;
  }

  let scopedCustomerIdsForSync: string[] | undefined;

  if (!auth.isSuperAdmin) {
    if (customerId && !hasCustomerScope(auth, customerId)) {
      fail('Access denied to this customer', 403, 'SCOPE_DENIED');
    }

    if (!customerId && !connectionId) {
      const scopedCustomerIds = getCustomerScopes(auth);
      if (scopedCustomerIds.length === 0) {
        fail('No customer scope assigned. Contact your administrator.', 400, 'NO_CUSTOMER_SCOPE');
      }
      scopedCustomerIdsForSync = scopedCustomerIds;
    }
  }

  if (connectionId) {
    if (!auth.isSuperAdmin) {
      fail('Only super admin can specify connectionId directly', 403, 'SCOPE_DENIED');
    }

    const conn = await prisma.gcpConnection.findFirst({
      where: { id: connectionId, isActive: true },
    });
    if (!conn) fail('GCP connection not found', 404, 'NOT_FOUND');
    return [conn];
  }

  if (customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { gcpConnectionId: true, name: true },
    });
    if (!customer) fail('Customer not found', 404, 'NOT_FOUND');
    if (!customer.gcpConnectionId) {
      fail(`Customer "${customer.name}" has no GCP connection assigned`, 400, 'NO_GCP_CONNECTION');
    }

    const conn = await prisma.gcpConnection.findFirst({
      where: { id: customer.gcpConnectionId, isActive: true },
    });
    if (!conn) fail('Customer\'s GCP connection not found or inactive', 404, 'NOT_FOUND');
    return [conn];
  }

  if (!auth.isSuperAdmin) {
    const scopedCustomerIds = scopedCustomerIdsForSync ?? getCustomerScopes(auth);
    const customers = await prisma.customer.findMany({
      where: { id: { in: scopedCustomerIds }, gcpConnectionId: { not: null } },
      select: { gcpConnectionId: true },
    });
    const connIds = Array.from(new Set(customers.map((customer) => customer.gcpConnectionId!)));
    const connections = connIds.length > 0
      ? await prisma.gcpConnection.findMany({
          where: {
            id: { in: connIds },
            isActive: true,
            billingProjectId: { not: null },
            billingDatasetId: { not: null },
            billingTableName: { not: null },
          },
        })
      : [];

    if (connections.length === 0) {
      fail('No configured BigQuery billing connections found for your customers.', 400, 'NO_BILLING_CONNECTIONS');
    }
    return connections;
  }

  const connections = await prisma.gcpConnection.findMany({
    where: {
      isActive: true,
      billingProjectId: { not: null },
      billingDatasetId: { not: null },
      billingTableName: { not: null },
    },
  });

  if (connections.length === 0) {
    fail(
      'No GCP connections with BigQuery billing config found. Configure billingProjectId, billingDatasetId, and billingTableName on at least one connection.',
      400,
      'NO_BILLING_CONNECTIONS'
    );
  }

  return connections;
}

export async function resolveBigQueryBillingSyncConnectionIds(
  input: BigQueryBillingSyncInput,
  auth: AuthContext
): Promise<string[]> {
  const connections = await resolveConnections(input, auth);
  return connections.map((connection) => connection.id).sort();
}

export async function runBigQueryBillingSync(
  input: BigQueryBillingSyncInput,
  auth: AuthContext
): Promise<BigQueryBillingSyncResult> {
  const { billingMonth } = input;
  const connections = await resolveConnections(input, auth);
  const results: BigQueryBillingSyncResult['batches'] = [];
  const errors: string[] = [];

  const affectedCustomers = await prisma.customer.findMany({
    where: { gcpConnectionId: { in: connections.map((conn) => conn.id) } },
    select: { id: true },
  });
  const affectedCustomerIds = affectedCustomers.map((customer) => customer.id);
  const lockReason = await getBillingMonthLockReason(
    billingMonth,
    affectedCustomerIds.length > 0 ? { customerIds: affectedCustomerIds } : {}
  );
  if (lockReason) {
    fail(lockReason, 409, 'LOCKED_BILLING_MONTH', {
      timestamp: new Date().toISOString(),
    });
  }

  for (const conn of connections) {
    try {
      if (!conn.billingProjectId || !conn.billingDatasetId || !conn.billingTableName) {
        errors.push(`Connection "${conn.name}" has no BigQuery billing config — skipped`);
        continue;
      }

      const reusedActiveBatch = await findReusableActiveBatchForConnection(conn, billingMonth);
      if (reusedActiveBatch) {
        results.push({
          connectionId: conn.id,
          connectionName: conn.name,
          batchId: reusedActiveBatch.id,
          rowCount: reusedActiveBatch.rowCount,
          reusedActiveBatch: true,
        });
        continue;
      }

      const adapter = createGcpBigQueryAdapterFromConnection(conn);
      const result = await ingestFromAdapter(
        adapter,
        billingMonth,
        auth.userId,
        conn.billingAccountIds.length > 0 ? conn.billingAccountIds : undefined
      );

      results.push({
        connectionId: conn.id,
        connectionName: conn.name,
        batchId: result.batchId,
        rowCount: result.rowCount,
      });
    } catch (err) {
      const message = `Connection "${conn.name}": ${err instanceof Error ? err.message : String(err)}`;
      errors.push(message);
      console.error('Billing fetch error:', message);
    }
  }

  const sourceConflicts = await findActiveBigQueryProjectOverlaps(
    billingMonth,
    affectedCustomerIds.length > 0 ? { customerIds: affectedCustomerIds } : {}
  );
  const totalRows = results.reduce((sum, result) => sum + result.rowCount, 0);

  return {
    message: `Fetched billing data for ${billingMonth}`,
    billingMonth,
    batches: results,
    totalRows,
    sourceConflictCount: sourceConflicts.length,
    sourceConflicts,
    errors: errors.length > 0 ? errors : undefined,
  };
}
