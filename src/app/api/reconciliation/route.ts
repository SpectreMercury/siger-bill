/**
 * /api/reconciliation
 *
 * Reconciliation report endpoint.
 * Compares raw cost data with generated invoices.
 *
 * GET - Get reconciliation report for a month
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { success, badRequest, serverError } from '@/lib/utils';

/**
 * GET /api/reconciliation
 *
 * Get reconciliation report comparing raw costs with invoiced amounts.
 * Query params: month (YYYY-MM format, required)
 *
 * Requires reconciliation:read permission.
 */
export const GET = withPermission(
  { resource: 'reconciliation', action: 'read' },
  async (request: NextRequest): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);
      const month = searchParams.get('month');

      if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        return badRequest('Valid month parameter required (YYYY-MM format)');
      }

      // Get raw cost totals from RawCostEntry
      const rawCostResult = await prisma.rawCostEntry.aggregate({
        where: {
          usageStartTime: {
            gte: new Date(`${month}-01`),
            lt: new Date(
              new Date(`${month}-01`).setMonth(
                new Date(`${month}-01`).getMonth() + 1
              )
            ),
          },
        },
        _sum: {
          cost: true,
        },
        _count: true,
      });

      // Get invoice totals
      const invoiceResult = await prisma.invoice.aggregate({
        where: {
          billingMonth: month,
          status: { not: 'CANCELLED' },
        },
        _sum: {
          subtotal: true,
          taxAmount: true,
          totalAmount: true,
        },
        _count: true,
      });

      // Get per-customer breakdown
      const customerReconciliation = await prisma.$queryRaw<
        Array<{
          customerId: string;
          customerName: string;
          rawCost: number;
          invoicedAmount: number;
        }>
      >`
        WITH customer_raw_costs AS (
          SELECT
            c.id as customer_id,
            c.name as customer_name,
            COALESCE(SUM(rce.cost), 0) as raw_cost
          FROM customers c
          LEFT JOIN customer_projects cp ON c.id = cp.customer_id
          LEFT JOIN raw_cost_entries rce ON rce.project_id = cp.project_id
            AND rce.usage_start_time >= ${new Date(`${month}-01`)}::timestamp
            AND rce.usage_start_time < ${new Date(
              new Date(`${month}-01`).setMonth(
                new Date(`${month}-01`).getMonth() + 1
              )
            )}::timestamp
          GROUP BY c.id, c.name
        ),
        customer_invoices AS (
          SELECT
            customer_id,
            COALESCE(SUM(total_amount), 0) as invoiced_amount
          FROM invoices
          WHERE billing_month = ${month}
            AND status != 'CANCELLED'
          GROUP BY customer_id
        )
        SELECT
          crc.customer_id as "customerId",
          crc.customer_name as "customerName",
          crc.raw_cost::float as "rawCost",
          COALESCE(ci.invoiced_amount, 0)::float as "invoicedAmount"
        FROM customer_raw_costs crc
        LEFT JOIN customer_invoices ci ON crc.customer_id = ci.customer_id
        WHERE crc.raw_cost > 0 OR COALESCE(ci.invoiced_amount, 0) > 0
        ORDER BY crc.raw_cost DESC
      `;

      // Find unassigned projects (projects with costs but no customer)
      const unassignedProjects = await prisma.$queryRaw<
        Array<{
          projectId: string;
          cost: number;
        }>
      >`
        SELECT
          rce.project_id as "projectId",
          SUM(rce.cost)::float as cost
        FROM raw_cost_entries rce
        LEFT JOIN customer_projects cp ON rce.project_id = cp.project_id
        WHERE cp.id IS NULL
          AND rce.usage_start_time >= ${new Date(`${month}-01`)}::timestamp
          AND rce.usage_start_time < ${new Date(
            new Date(`${month}-01`).setMonth(
              new Date(`${month}-01`).getMonth() + 1
            )
          )}::timestamp
        GROUP BY rce.project_id
        ORDER BY cost DESC
        LIMIT 50
      `;

      // Get invoice run info
      const invoiceRuns = await prisma.invoiceRun.findMany({
        where: { billingMonth: month },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          status: true,
          totalInvoices: true,
          totalAmount: true,
          createdAt: true,
        },
      });

      const rawCostTotal = Number(rawCostResult._sum.cost || 0);
      const invoicedTotal = Number(invoiceResult._sum.totalAmount || 0);
      const variance = invoicedTotal - rawCostTotal;
      const variancePercent = rawCostTotal > 0 ? (variance / rawCostTotal) * 100 : 0;

      return success({
        month,
        summary: {
          rawCostTotal,
          rawCostEntryCount: rawCostResult._count,
          invoicedSubtotal: Number(invoiceResult._sum.subtotal || 0),
          invoicedTax: Number(invoiceResult._sum.taxAmount || 0),
          invoicedTotal,
          invoiceCount: invoiceResult._count,
          variance,
          variancePercent: Math.round(variancePercent * 100) / 100,
        },
        customerBreakdown: customerReconciliation.map((c) => ({
          customerId: c.customerId,
          customerName: c.customerName,
          rawCost: c.rawCost,
          invoicedAmount: c.invoicedAmount,
          variance: c.invoicedAmount - c.rawCost,
        })),
        unassignedProjects,
        unassignedCostTotal: unassignedProjects.reduce((sum, p) => sum + p.cost, 0),
        invoiceRuns,
      });

    } catch (error) {
      console.error('Failed to generate reconciliation report:', error);
      return serverError('Failed to generate reconciliation report');
    }
  }
);
