import { NextRequest, NextResponse } from 'next/server';
import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getCustomerScopes, hasCustomerScope, hasPermission } from '@/lib/auth/context';
import { withPermission } from '@/lib/middleware';
import { logAuditEvent } from '@/lib/audit';
import { badRequest, conflict, forbidden, serverError, success } from '@/lib/utils';
import { chargeTypeToBillable } from '@/lib/project-billing-configs/charge-type';
import { ensureActiveCustomerProjectBinding } from '@/lib/project-billing-configs/bindings';
import {
  parseProjectBillingConfigWorkbook,
  type ProjectBillingConfigImportRow,
} from '@/lib/project-billing-configs/workbook';

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

class ProjectBillingImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectBillingImportError';
  }
}

class ProjectBillingImportForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectBillingImportForbiddenError';
  }
}

type ResolvedImportRow = ProjectBillingConfigImportRow & {
  customer: { id: string; name: string } | null;
  billingAccountDbId: string | null;
};

export const POST = withPermission(
  { resource: 'project_billing_configs', action: 'create' },
  async (request: NextRequest, context): Promise<NextResponse> => {
    try {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!(file instanceof File)) return badRequest('请选择要导入的 Excel 文件');
      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        return badRequest('仅支持 .xlsx 文件');
      }
      if (file.size > MAX_IMPORT_BYTES) return badRequest('Excel 文件不能超过 10 MB');

      let rows: ProjectBillingConfigImportRow[];
      try {
        rows = parseProjectBillingConfigWorkbook(Buffer.from(await file.arrayBuffer()));
      } catch (error) {
        throw new ProjectBillingImportError(
          error instanceof Error ? error.message : '无法解析 Excel 文件'
        );
      }

      const [customers, billingAccounts] = await Promise.all([
        prisma.customer.findMany({
          where: context.auth.isSuperAdmin
            ? undefined
            : { id: { in: getCustomerScopes(context.auth) } },
          select: { id: true, name: true, externalId: true },
        }),
        prisma.billingAccount.findMany({
          select: { id: true, billingAccountId: true },
        }),
      ]);

      const customersByKey = new Map<string, Array<{ id: string; name: string }>>();
      for (const customer of customers) {
        for (const value of [customer.name, customer.externalId]) {
          const key = value?.trim().toLowerCase();
          if (!key) continue;
          const matches = customersByKey.get(key) ?? [];
          if (!matches.some((match) => match.id === customer.id)) {
            matches.push({ id: customer.id, name: customer.name });
          }
          customersByKey.set(key, matches);
        }
      }
      const billingAccountByExternalId = new Map(
        billingAccounts.map((account) => [account.billingAccountId, account.id])
      );

      const resolvedRows: ResolvedImportRow[] = rows.map((row) => {
        const customerMatches = row.customerName
          ? customersByKey.get(row.customerName.toLowerCase()) ?? []
          : [];
        if (row.customerName && customerMatches.length === 0) {
          throw new ProjectBillingImportError(
            `第 ${row.rowNumber} 行客户“${row.customerName}”不存在`
          );
        }
        if (customerMatches.length > 1) {
          throw new ProjectBillingImportError(
            `第 ${row.rowNumber} 行客户“${row.customerName}”匹配到多条记录，请改用唯一 External ID`
          );
        }

        const billingAccountDbId = row.billingAccountId
          ? billingAccountByExternalId.get(row.billingAccountId) ?? null
          : null;
        if (row.billingAccountId && !billingAccountDbId) {
          throw new ProjectBillingImportError(
            `第 ${row.rowNumber} 行 Billing ID“${row.billingAccountId}”不存在`
          );
        }

        return {
          ...row,
          customer: customerMatches[0] ?? null,
          billingAccountDbId,
        };
      });
      const inaccessibleCustomer = resolvedRows.find(
        (row) => row.customer && !hasCustomerScope(context.auth, row.customer.id)
      );
      if (inaccessibleCustomer?.customer) {
        return forbidden(
          `You do not have access to customer '${inaccessibleCustomer.customer.name}'`
        );
      }

      const existing = await prisma.projectBillingConfig.findMany({
        where: { projectId: { in: resolvedRows.map((row) => row.projectId) } },
        select: {
          projectId: true,
          customerProjects: {
            where: { isActive: true },
            select: { customerId: true },
          },
        },
      });
      if (
        existing.length > 0
        && !hasPermission(context.auth, 'project_billing_configs', 'update')
      ) {
        return forbidden('Updating existing Project billing configs requires update permission');
      }
      const inaccessibleExistingBinding = existing
        .flatMap((config) => config.customerProjects)
        .find((binding) => !hasCustomerScope(context.auth, binding.customerId));
      if (inaccessibleExistingBinding) {
        return forbidden('You do not have access to a customer currently bound to an imported Project');
      }
      const result = await prisma.$transaction(async (tx) => {
        const transactionExisting = await tx.projectBillingConfig.findMany({
          where: { projectId: { in: resolvedRows.map((row) => row.projectId) } },
          select: {
            id: true,
            projectId: true,
            name: true,
            chargeType: true,
            billable: true,
            billingAccountId: true,
            customerProjects: {
              where: { isActive: true },
              select: { customerId: true },
            },
          },
        });
        if (
          transactionExisting.length > 0
          && !hasPermission(context.auth, 'project_billing_configs', 'update')
        ) {
          throw new ProjectBillingImportForbiddenError(
            'Updating existing Project billing configs requires update permission'
          );
        }
        const inaccessibleTransactionBinding = transactionExisting
          .flatMap((config) => config.customerProjects)
          .find((binding) => !hasCustomerScope(context.auth, binding.customerId));
        if (inaccessibleTransactionBinding) {
          throw new ProjectBillingImportForbiddenError(
            'You do not have access to a customer currently bound to an imported Project'
          );
        }
        const existingProjectIds = new Set(
          transactionExisting.map((row) => row.projectId)
        );
        const configIds: string[] = [];
        const configsAfter: Array<{
          id: string;
          projectId: string;
          name: string | null;
          chargeType: string;
          billable: boolean;
          billingAccountId: string | null;
        }> = [];
        for (const row of resolvedRows) {
          const config = await tx.projectBillingConfig.upsert({
            where: { projectId: row.projectId },
            create: {
              projectId: row.projectId,
              name: row.name,
              chargeType: row.chargeType,
              billable: chargeTypeToBillable(row.chargeType),
              billingAccountId: row.billingAccountDbId,
              createdBy: context.auth.userId,
              updatedBy: context.auth.userId,
            },
            update: {
              name: row.name,
              chargeType: row.chargeType,
              billable: chargeTypeToBillable(row.chargeType),
              billingAccountId: row.billingAccountDbId,
              updatedBy: context.auth.userId,
            },
            select: {
              id: true,
              projectId: true,
              name: true,
              chargeType: true,
              billable: true,
              billingAccountId: true,
            },
          });
          configIds.push(config.id);
          configsAfter.push(config);

          await tx.customerProject.updateMany({
            where: {
              projectId: row.projectId,
              isActive: true,
              ...(row.customer ? { customerId: { not: row.customer.id } } : {}),
            },
            data: {
              isActive: false,
              endDate: new Date(),
            },
          });
          if (row.customer) {
            await ensureActiveCustomerProjectBinding(
              tx,
              row.customer.id,
              row.projectId
            );
          }
        }

        const createdCount = resolvedRows.filter(
          (row) => !existingProjectIds.has(row.projectId)
        ).length;
        const updatedCount = resolvedRows.length - createdCount;
        const activeBindingsAfter = await tx.customerProject.findMany({
          where: {
            projectId: { in: resolvedRows.map((row) => row.projectId) },
            isActive: true,
          },
          select: { projectId: true, customerId: true },
          orderBy: [{ projectId: 'asc' }, { customerId: 'asc' }],
        });
        const customerIdsAfterByProject = new Map<string, string[]>();
        for (const binding of activeBindingsAfter) {
          const customerIds = customerIdsAfterByProject.get(binding.projectId) ?? [];
          customerIds.push(binding.customerId);
          customerIdsAfterByProject.set(binding.projectId, customerIds);
        }
        await logAuditEvent(context, {
          action: AuditAction.IMPORT,
          targetTable: 'project_billing_configs',
          beforeData: {
            configs: transactionExisting.map((config) => ({
              id: config.id,
              projectId: config.projectId,
              name: config.name,
              chargeType: config.chargeType,
              billable: config.billable,
              billingAccountId: config.billingAccountId,
              customerIds: config.customerProjects.map((binding) => binding.customerId),
            })),
          },
          afterData: {
            configs: configsAfter.map((config) => ({
              ...config,
              customerIds: customerIdsAfterByProject.get(config.projectId) ?? [],
            })),
          },
          metadata: {
            sourceFilename: file.name,
            rowCount: resolvedRows.length,
            createdCount,
            updatedCount,
            projectIds: resolvedRows.map((row) => row.projectId),
            configIds,
          },
        }, { db: tx, strict: true });

        return { createdCount, updatedCount };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      return success({
        message: 'Project 计费配置导入成功',
        rowCount: resolvedRows.length,
        ...result,
      });
    } catch (error) {
      if (error instanceof ProjectBillingImportError) return badRequest(error.message);
      if (error instanceof ProjectBillingImportForbiddenError) return forbidden(error.message);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return conflict('导入数据与现有 Project 配置冲突');
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        return conflict('Project 配置刚刚发生变化，请重试导入');
      }
      console.error('Failed to import project billing configs:', error);
      return serverError('Project 计费配置导入失败');
    }
  }
);
