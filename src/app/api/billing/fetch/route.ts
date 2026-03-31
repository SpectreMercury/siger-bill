/**
 * /api/billing/fetch
 *
 * POST - Fetch billing data from BigQuery for a given billing month.
 *
 * Uses the customer's GcpConnection (or specified connectionId) to:
 * 1. Load BigQuery billing config from DB
 * 2. Create a BigQuery adapter with the connection's credentials
 * 3. Fetch and ingest billing data into BillingLineItem table
 *
 * Required body:
 * - billingMonth: string (YYYY-MM)
 *
 * Optional body:
 * - connectionId: string (UUID) - specific GcpConnection to use
 * - customerId: string (UUID) - fetch only for this customer's connection
 *
 * Returns: ingestion batch info
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { logAuditEvent } from '@/lib/audit';
import { AuditAction } from '@prisma/client';
import { success, serverError, badRequest, notFound } from '@/lib/utils';
import { createGcpBigQueryAdapterFromConnection } from '@/lib/billing/adapters/gcp-bigquery';
import { ingestFromAdapter } from '@/lib/billing/unified-engine';
import { hasCustomerScope, getCustomerScopes } from '@/lib/auth/context';
import { z } from 'zod';

const fetchSchema = z.object({
  billingMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Must be YYYY-MM format'),
  connectionId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
});

/**
 * POST /api/billing/fetch
 *
 * Fetch billing data from BigQuery and ingest into BillingLineItem table.
 * Requires raw_cost:import permission (reuses existing permission).
 */
export const POST = withPermission(
  { resource: 'raw_cost', action: 'import' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const body = await request.json();
      const validation = fetchSchema.safeParse(body);
      if (!validation.success) {
        return badRequest('Invalid request body', { errors: validation.error.flatten() });
      }

      const { billingMonth, connectionId, customerId } = validation.data;
      const results: Array<{
        connectionId: string;
        connectionName: string;
        batchId: string;
        rowCount: number;
      }> = [];
      const errors: string[] = [];

      // Scope enforcement: non-super-admin can only fetch for their own customers
      if (!context.auth.isSuperAdmin) {
        if (customerId && !hasCustomerScope(context.auth, customerId)) {
          return NextResponse.json(
            { error: 'Access denied to this customer', code: 'SCOPE_DENIED' },
            { status: 403 }
          );
        }
        // If no customerId specified, restrict to user's scoped customers
        if (!customerId && !connectionId) {
          const scopedCustomerIds = getCustomerScopes(context.auth);
          if (scopedCustomerIds.length === 0) {
            return badRequest('No customer scope assigned. Contact your administrator.');
          }
          // Will be handled below — fetch only for scoped customers' connections
        }
      }

      // Determine which connections to use
      let connections: Array<{
        id: string;
        name: string;
        billingProjectId: string | null;
        billingDatasetId: string | null;
        billingTableName: string | null;
        billingAccountIds: string[];
        credentials: unknown;
        authType: string;
      }>;

      if (connectionId) {
        // Super admin only: fetch by specific connectionId
        if (!context.auth.isSuperAdmin) {
          return NextResponse.json(
            { error: 'Only super admin can specify connectionId directly', code: 'SCOPE_DENIED' },
            { status: 403 }
          );
        }
        const conn = await prisma.gcpConnection.findFirst({
          where: { id: connectionId, isActive: true },
        });
        if (!conn) return notFound('GCP connection not found');
        connections = [conn];
      } else if (customerId) {
        // Customer's connection (scope already checked above)
        const customer = await prisma.customer.findUnique({
          where: { id: customerId },
          select: { gcpConnectionId: true, name: true },
        });
        if (!customer) return notFound('Customer not found');
        if (!customer.gcpConnectionId) {
          return badRequest(`Customer "${customer.name}" has no GCP connection assigned`);
        }
        const conn = await prisma.gcpConnection.findFirst({
          where: { id: customer.gcpConnectionId, isActive: true },
        });
        if (!conn) return notFound('Customer\'s GCP connection not found or inactive');
        connections = [conn];
      } else if (!context.auth.isSuperAdmin) {
        // Non-super-admin without customerId: fetch for all their scoped customers
        const scopedCustomerIds = getCustomerScopes(context.auth);
        const customers = await prisma.customer.findMany({
          where: { id: { in: scopedCustomerIds }, gcpConnectionId: { not: null } },
          select: { gcpConnectionId: true },
        });
        const connIds = Array.from(new Set(customers.map((c) => c.gcpConnectionId!)));
        connections = connIds.length > 0
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
          return badRequest('No configured BigQuery billing connections found for your customers.');
        }
      } else {
        // Super admin: all active connections with billing config
        connections = await prisma.gcpConnection.findMany({
          where: {
            isActive: true,
            billingProjectId: { not: null },
            billingDatasetId: { not: null },
            billingTableName: { not: null },
          },
        });

        if (connections.length === 0) {
          return badRequest(
            'No GCP connections with BigQuery billing config found. Configure billingProjectId, billingDatasetId, and billingTableName on at least one connection.'
          );
        }
      }

      // Fetch from each connection
      for (const conn of connections) {
        try {
          // Validate billing config exists
          if (!conn.billingProjectId || !conn.billingDatasetId || !conn.billingTableName) {
            errors.push(`Connection "${conn.name}" has no BigQuery billing config — skipped`);
            continue;
          }

          const adapter = createGcpBigQueryAdapterFromConnection(conn);
          const result = await ingestFromAdapter(
            adapter,
            billingMonth,
            context.auth.userId,
            conn.billingAccountIds.length > 0 ? conn.billingAccountIds : undefined
          );

          results.push({
            connectionId: conn.id,
            connectionName: conn.name,
            batchId: result.batchId,
            rowCount: result.rowCount,
          });
        } catch (err) {
          const msg = `Connection "${conn.name}": ${err instanceof Error ? err.message : String(err)}`;
          errors.push(msg);
          console.error('Billing fetch error:', msg);
        }
      }

      // Audit log
      await logAuditEvent(context, {
        action: AuditAction.IMPORT,
        targetTable: 'billing_line_items',
        targetId: billingMonth,
        afterData: {
          billingMonth,
          connectionsProcessed: connections.length,
          batchesCreated: results.length,
          totalRows: results.reduce((sum, r) => sum + r.rowCount, 0),
          errors: errors.length > 0 ? errors : undefined,
        },
      });

      return success({
        message: `Fetched billing data for ${billingMonth}`,
        billingMonth,
        batches: results,
        totalRows: results.reduce((sum, r) => sum + r.rowCount, 0),
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error('Failed to fetch billing data:', error);
      return serverError('Failed to fetch billing data');
    }
  }
);
