import type { Prisma } from '@prisma/client';
import {
  buildNullProjectAttributionPlan,
  flattenNullProjectAttributionConfig,
  NullProjectAttributionConfigError,
  validateNullProjectAttributionConfig,
  type FlatNullProjectAttributionConfigItem,
  type NullProjectAttributionConfigItem,
  type NullProjectAttributionMapping,
  type NullProjectAttributionPlan,
} from './null-project-attribution';

type NullProjectAttributionDb = Pick<Prisma.TransactionClient, 'specialRule'>;
type NullProjectAttributionWriteDb = Pick<
  Prisma.TransactionClient,
  'billingAccount' | 'projectBillingConfig' | 'specialRule'
>;

export type PrepareNullProjectAttributionMappingsInput = {
  config: NullProjectAttributionConfigItem[];
  effectiveStart: Date | null;
  effectiveEnd: Date | null;
  excludeRuleId?: string;
  enforceConflicts?: boolean;
};

function billingMonthRange(billingMonth: string): { start: Date; end: Date } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(billingMonth)) {
    throw new NullProjectAttributionConfigError(
      `Invalid billing month ${billingMonth}; expected YYYY-MM`
    );
  }
  const [year, month] = billingMonth.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
  };
}

function startOfBillingMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfBillingMonth(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    0,
    23,
    59,
    59,
    999
  ));
}

export async function loadNullProjectAttributionPlan(
  db: NullProjectAttributionDb,
  billingMonth: string
): Promise<NullProjectAttributionPlan> {
  const { start, end } = billingMonthRange(billingMonth);
  const rules = await db.specialRule.findMany({
    where: {
      customerId: null,
      ruleType: 'ASSIGN_NULL_PROJECT',
      enabled: true,
      deletedAt: null,
      OR: [
        { effectiveStart: null, effectiveEnd: null },
        { effectiveStart: null, effectiveEnd: { gte: start } },
        { effectiveEnd: null, effectiveStart: { lte: end } },
        { effectiveStart: { lte: end }, effectiveEnd: { gte: start } },
      ],
    },
    orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      nullProjectMappings: {
        select: {
          billingAccountId: true,
          skuId: true,
          projectId: true,
          targetProject: {
            select: {
              billable: true,
              customerProjects: {
                where: { isActive: true },
                select: { customerId: true },
              },
            },
          },
        },
      },
    },
  });

  const mappings: NullProjectAttributionMapping[] = [];
  for (const rule of rules) {
    for (const mapping of rule.nullProjectMappings) {
      if (!mapping.targetProject.billable) {
        throw new NullProjectAttributionConfigError(
          `Project ${mapping.projectId} must be billable`
        );
      }
      if (mapping.targetProject.customerProjects.length !== 1) {
        throw new NullProjectAttributionConfigError(
          `Project ${mapping.projectId} must have exactly one active customer binding`
        );
      }
      mappings.push({
        ruleId: rule.id,
        ruleName: rule.name,
        billingAccountId: mapping.billingAccountId,
        skuId: mapping.skuId,
        projectId: mapping.projectId,
        targetCustomerId: mapping.targetProject.customerProjects[0].customerId,
      });
    }
  }

  return buildNullProjectAttributionPlan(mappings);
}

export async function prepareNullProjectAttributionMappings(
  db: NullProjectAttributionWriteDb,
  input: PrepareNullProjectAttributionMappingsInput
): Promise<FlatNullProjectAttributionConfigItem[]> {
  const flattened = flattenNullProjectAttributionConfig(input.config);
  const billingAccountIds = Array.from(new Set(
    flattened.map((mapping) => mapping.billingAccountId)
  ));
  const projectIds = Array.from(new Set(
    flattened.map((mapping) => mapping.projectId)
  ));
  const skuIds = Array.from(new Set(flattened.map((mapping) => mapping.skuId)));

  const overlapFilters: Prisma.SpecialRuleWhereInput[] = [];
  if (input.effectiveEnd) {
    const effectiveEndMonth = endOfBillingMonth(input.effectiveEnd);
    overlapFilters.push({
      OR: [
        { effectiveStart: null },
        { effectiveStart: { lte: effectiveEndMonth } },
      ],
    });
  }
  if (input.effectiveStart) {
    const effectiveStartMonth = startOfBillingMonth(input.effectiveStart);
    overlapFilters.push({
      OR: [
        { effectiveEnd: null },
        { effectiveEnd: { gte: effectiveStartMonth } },
      ],
    });
  }

  const [billingAccounts, projects, conflictingRules] = await Promise.all([
    db.billingAccount.findMany({
      where: { billingAccountId: { in: billingAccountIds } },
      select: { billingAccountId: true },
    }),
    db.projectBillingConfig.findMany({
      where: { projectId: { in: projectIds } },
      select: {
        projectId: true,
        billable: true,
        customerProjects: {
          where: { isActive: true },
          select: { customerId: true },
        },
      },
    }),
    input.enforceConflicts === false
      ? Promise.resolve([])
      : db.specialRule.findMany({
          where: {
            ruleType: 'ASSIGN_NULL_PROJECT',
            enabled: true,
            deletedAt: null,
            ...(input.excludeRuleId ? { id: { not: input.excludeRuleId } } : {}),
            ...(overlapFilters.length > 0 ? { AND: overlapFilters } : {}),
            nullProjectMappings: {
              some: {
                billingAccountId: { in: billingAccountIds },
                skuId: { in: skuIds },
              },
            },
          },
          select: {
            id: true,
            name: true,
            nullProjectMappings: {
              where: {
                billingAccountId: { in: billingAccountIds },
                skuId: { in: skuIds },
              },
              select: {
                billingAccountId: true,
                skuId: true,
                projectId: true,
              },
            },
          },
        }),
  ]);

  return validateNullProjectAttributionConfig(input.config, {
    billingAccountIds: billingAccounts.map((account) => account.billingAccountId),
    projects: projects.map((project) => ({
      projectId: project.projectId,
      billable: project.billable,
      activeCustomerIds: project.customerProjects.map((binding) => binding.customerId),
    })),
    existingMappings: conflictingRules.flatMap((rule) =>
      rule.nullProjectMappings.map((mapping) => ({
        ruleId: rule.id,
        ruleName: rule.name,
        billingAccountId: mapping.billingAccountId,
        skuId: mapping.skuId,
        projectId: mapping.projectId,
      }))
    ),
  });
}
