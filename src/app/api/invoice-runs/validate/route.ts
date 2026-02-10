/**
 * /api/invoice-runs/validate
 *
 * Invoice run validation endpoint.
 * Performs pre-run checks to identify potential issues.
 *
 * POST - Validate invoice run configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withPermission } from '@/lib/middleware';
import { validateBody, success, badRequest, serverError } from '@/lib/utils';
import { z } from 'zod';

/**
 * Validation request schema
 */
const validateRunSchema = z.object({
  billingMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Must be YYYY-MM format'),
  targetCustomerId: z.string().uuid().optional(),
});

/**
 * POST /api/invoice-runs/validate
 *
 * Validate a potential invoice run before execution.
 * Returns warnings and errors that should be addressed.
 */
export const POST = withPermission(
  { resource: 'invoice_runs', action: 'create' },
  async (request: NextRequest): Promise<NextResponse> => {
    try {
      // Validate request body
      const validation = await validateBody(request, validateRunSchema);
      if (!validation.success) {
        return badRequest('Invalid request', validation.error.flatten());
      }

      const { billingMonth, targetCustomerId } = validation.data;

      const errors: Array<{ code: string; message: string; details?: unknown }> = [];
      const warnings: Array<{ code: string; message: string; details?: unknown }> = [];

      // 1. Check for existing runs
      const existingRuns = await prisma.invoiceRun.findMany({
        where: {
          billingMonth,
          status: { in: ['QUEUED', 'RUNNING', 'SUCCEEDED', 'LOCKED'] },
        },
        select: { id: true, status: true, createdAt: true },
      });

      if (existingRuns.some((r) => r.status === 'LOCKED')) {
        errors.push({
          code: 'MONTH_LOCKED',
          message: `Billing month ${billingMonth} is already locked`,
          details: existingRuns.find((r) => r.status === 'LOCKED'),
        });
      }

      if (existingRuns.some((r) => r.status === 'RUNNING')) {
        errors.push({
          code: 'RUN_IN_PROGRESS',
          message: 'An invoice run is currently in progress for this month',
          details: existingRuns.find((r) => r.status === 'RUNNING'),
        });
      }

      if (existingRuns.some((r) => r.status === 'SUCCEEDED')) {
        warnings.push({
          code: 'PREVIOUS_RUN_EXISTS',
          message: 'A successful run already exists for this month. Running again will create duplicate invoices.',
          details: existingRuns.filter((r) => r.status === 'SUCCEEDED'),
        });
      }

      // 2. Check for raw cost data
      const monthStart = new Date(`${billingMonth}-01`);
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);

      const rawCostCount = await prisma.rawCostEntry.count({
        where: {
          usageStartTime: { gte: monthStart, lt: monthEnd },
        },
      });

      if (rawCostCount === 0) {
        errors.push({
          code: 'NO_COST_DATA',
          message: `No raw cost data found for ${billingMonth}`,
        });
      }

      // 3. Check for unassigned projects
      const unassignedProjects = await prisma.$queryRaw<
        Array<{ projectId: string; costSum: number }>
      >`
        SELECT
          rce.project_id as "projectId",
          SUM(rce.cost)::float as "costSum"
        FROM raw_cost_entries rce
        LEFT JOIN customer_projects cp ON rce.project_id = cp.project_id
        WHERE cp.id IS NULL
          AND rce.usage_start_time >= ${monthStart}::timestamp
          AND rce.usage_start_time < ${monthEnd}::timestamp
        GROUP BY rce.project_id
        ORDER BY "costSum" DESC
        LIMIT 20
      `;

      if (unassignedProjects.length > 0) {
        const totalUnassignedCost = unassignedProjects.reduce((sum, p) => sum + p.costSum, 0);
        warnings.push({
          code: 'UNASSIGNED_PROJECTS',
          message: `${unassignedProjects.length} project(s) with costs are not assigned to any customer`,
          details: {
            count: unassignedProjects.length,
            totalCost: totalUnassignedCost,
            projects: unassignedProjects,
          },
        });
      }

      // 4. Check for SKUs without group mapping
      const unmappedSkus = await prisma.$queryRaw<
        Array<{ skuId: string; serviceId: string; costSum: number }>
      >`
        SELECT
          rce.sku_id as "skuId",
          rce.service_id as "serviceId",
          SUM(rce.cost)::float as "costSum"
        FROM raw_cost_entries rce
        LEFT JOIN skus s ON rce.sku_id = s.sku_id
        LEFT JOIN sku_group_mappings sgm ON s.id = sgm.sku_id
        WHERE sgm.id IS NULL
          AND rce.usage_start_time >= ${monthStart}::timestamp
          AND rce.usage_start_time < ${monthEnd}::timestamp
        GROUP BY rce.sku_id, rce.service_id
        ORDER BY "costSum" DESC
        LIMIT 20
      `;

      if (unmappedSkus.length > 0) {
        const totalUnmappedCost = unmappedSkus.reduce((sum, s) => sum + s.costSum, 0);
        warnings.push({
          code: 'UNMAPPED_SKUS',
          message: `${unmappedSkus.length} SKU(s) are not mapped to any SKU group`,
          details: {
            count: unmappedSkus.length,
            totalCost: totalUnmappedCost,
            skus: unmappedSkus,
          },
        });
      }

      // 5. Check customer count
      let customerCount = 0;
      if (targetCustomerId) {
        const customer = await prisma.customer.findUnique({
          where: { id: targetCustomerId, status: 'ACTIVE' },
        });
        if (!customer) {
          errors.push({
            code: 'INVALID_CUSTOMER',
            message: 'Target customer not found or not active',
          });
        } else {
          customerCount = 1;
        }
      } else {
        customerCount = await prisma.customer.count({
          where: { status: 'ACTIVE' },
        });
      }

      if (customerCount === 0) {
        errors.push({
          code: 'NO_ACTIVE_CUSTOMERS',
          message: 'No active customers found',
        });
      }

      // 6. Check for customers without pricing lists
      const customersWithoutPricing = await prisma.customer.findMany({
        where: {
          status: 'ACTIVE',
          pricingLists: { none: { status: 'ACTIVE' } },
        },
        select: { id: true, name: true },
        take: 10,
      });

      if (customersWithoutPricing.length > 0) {
        warnings.push({
          code: 'CUSTOMERS_WITHOUT_PRICING',
          message: `${customersWithoutPricing.length} customer(s) have no active pricing list`,
          details: {
            count: customersWithoutPricing.length,
            customers: customersWithoutPricing,
          },
        });
      }

      // Build summary
      const summary = {
        billingMonth,
        targetCustomerId,
        rawCostEntryCount: rawCostCount,
        customerCount,
        canProceed: errors.length === 0,
      };

      return success({
        valid: errors.length === 0,
        summary,
        errors,
        warnings,
      });

    } catch (error) {
      console.error('Failed to validate invoice run:', error);
      return serverError('Failed to validate invoice run');
    }
  }
);
