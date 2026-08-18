/* eslint-disable @typescript-eslint/no-require-imports -- this CommonJS ts-node smoke test loads workspace modules by absolute path */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const modulePath = join(
  process.cwd(),
  'src/lib/special-rules/null-project-attribution.ts'
);

assert(
  existsSync(modulePath),
  'Null-project attribution module must exist'
);

const {
  buildNullProjectAttributionPlan,
  flattenNullProjectAttributionConfig,
  groupNullProjectAttributionMappings,
  normalizeNullProjectAttributionConfig,
  validateNullProjectAttributionConfig,
  NullProjectAttributionConfigError,
  NullProjectAttributionConflictError,
} = require(modulePath) as {
  NullProjectAttributionConfigError: new (message: string) => Error;
  NullProjectAttributionConflictError: new (billingAccountId: string, skuId: string) => Error;
  buildNullProjectAttributionPlan: (mappings: Array<{
    ruleId: string;
    ruleName: string;
    billingAccountId: string;
    skuId: string;
    projectId: string;
  }>) => {
    mappings?: Array<{
      ruleId: string;
      ruleName: string;
      billingAccountId: string;
      skuId: string;
      projectId: string;
    }>;
    resolve: (line: {
      billingAccountId: string;
      skuId: string;
      projectId: string | null;
    }) => { ruleId: string; ruleName: string; projectId: string } | null;
  };
  normalizeNullProjectAttributionConfig?: (config: Array<{
    billingAccountId: string;
    skuIds: string[];
    projectId: string;
  }>) => Array<{
    billingAccountId: string;
    skuIds: string[];
    projectId: string;
  }>;
  flattenNullProjectAttributionConfig?: (config: Array<{
    billingAccountId: string;
    skuIds: string[];
    projectId: string;
  }>) => Array<{
    billingAccountId: string;
    skuId: string;
    projectId: string;
  }>;
  groupNullProjectAttributionMappings?: (mappings: Array<{
    billingAccountId: string;
    skuId: string;
    projectId: string;
  }>) => Array<{
    billingAccountId: string;
    skuIds: string[];
    projectId: string;
  }>;
  validateNullProjectAttributionConfig?: (
    config: Array<{ billingAccountId: string; skuIds: string[]; projectId: string }>,
    references: {
      billingAccountIds: string[];
      projects: Array<{ projectId: string; billable: boolean; activeCustomerIds: string[] }>;
      existingMappings?: Array<{
        ruleId: string;
        ruleName: string;
        billingAccountId: string;
        skuId: string;
        projectId: string;
      }>;
    }
  ) => Array<{ billingAccountId: string; skuId: string; projectId: string }>;
};

assert(
  new NullProjectAttributionConflictError('BILLING-1', 'sku-1')
    instanceof NullProjectAttributionConfigError,
  'Runtime mapping conflicts must follow the same configuration-error response path'
);

assert.equal(
  typeof normalizeNullProjectAttributionConfig,
  'function',
  'Grouped JSON configuration must have a normalizer'
);

assert.deepEqual(
  normalizeNullProjectAttributionConfig!([
    {
      billingAccountId: ' 01c462-ee4fd8-dd95a6 ',
      skuIds: [' sku-1 ', 'sku-1', 'sku-2'],
      projectId: ' shared-charges-project ',
    },
  ]),
  [
    {
      billingAccountId: '01C462-EE4FD8-DD95A6',
      skuIds: ['sku-1', 'sku-2'],
      projectId: 'shared-charges-project',
    },
  ],
  'Grouped configuration should trim values, uppercase Billing IDs, and deduplicate SKUs'
);

assert.equal(
  typeof flattenNullProjectAttributionConfig,
  'function',
  'Grouped API configuration must flatten into exact database matches'
);
assert.deepEqual(
  flattenNullProjectAttributionConfig!([
    {
      billingAccountId: 'billing-1',
      skuIds: ['sku-1', 'sku-2'],
      projectId: 'project-1',
    },
  ]),
  [
    { billingAccountId: 'BILLING-1', skuId: 'sku-1', projectId: 'project-1' },
    { billingAccountId: 'BILLING-1', skuId: 'sku-2', projectId: 'project-1' },
  ],
  'Each SKU should persist as its own exact mapping row'
);

assert.equal(
  typeof groupNullProjectAttributionMappings,
  'function',
  'Database mappings must group back into the public JSON interface'
);
assert.deepEqual(
  groupNullProjectAttributionMappings!([
    { billingAccountId: 'BILLING-1', skuId: 'sku-2', projectId: 'project-1' },
    { billingAccountId: 'BILLING-1', skuId: 'sku-1', projectId: 'project-1' },
  ]),
  [
    {
      billingAccountId: 'BILLING-1',
      skuIds: ['sku-1', 'sku-2'],
      projectId: 'project-1',
    },
  ],
  'The API response should group and sort SKUs deterministically'
);

assert.equal(
  typeof validateNullProjectAttributionConfig,
  'function',
  'Attribution configuration must validate its billing and project references'
);
assert.deepEqual(
  validateNullProjectAttributionConfig!(
    [{ billingAccountId: 'billing-1', skuIds: ['sku-1'], projectId: 'project-1' }],
    {
      billingAccountIds: ['BILLING-1'],
      projects: [
        { projectId: 'project-1', billable: true, activeCustomerIds: ['customer-1'] },
      ],
    }
  ),
  [{ billingAccountId: 'BILLING-1', skuId: 'sku-1', projectId: 'project-1' }],
  'A registered Billing ID and singly-bound billable project should be accepted'
);

assert.throws(
  () => validateNullProjectAttributionConfig!(
    [{ billingAccountId: 'unknown-billing', skuIds: ['sku-1'], projectId: 'project-1' }],
    {
      billingAccountIds: ['BILLING-1'],
      projects: [
        { projectId: 'project-1', billable: true, activeCustomerIds: ['customer-1'] },
      ],
    }
  ),
  /Billing ID UNKNOWN-BILLING is not registered/,
  'A typo in Billing ID must be rejected before billing runs'
);

assert.throws(
  () => validateNullProjectAttributionConfig!(
    [{ billingAccountId: 'billing-1', skuIds: ['sku-1'], projectId: 'unbound-project' }],
    {
      billingAccountIds: ['BILLING-1'],
      projects: [
        { projectId: 'unbound-project', billable: true, activeCustomerIds: [] },
      ],
    }
  ),
  /Project unbound-project must have exactly one active customer binding/,
  'A target project without one unambiguous customer must be rejected'
);

assert.throws(
  () => validateNullProjectAttributionConfig!(
    [{ billingAccountId: 'billing-1', skuIds: ['sku-1'], projectId: 'free-project' }],
    {
      billingAccountIds: ['BILLING-1'],
      projects: [
        { projectId: 'free-project', billable: false, activeCustomerIds: ['customer-1'] },
      ],
    }
  ),
  /Project free-project must be billable/,
  'A non-billable virtual project cannot receive invoice charges'
);

assert.throws(
  () => validateNullProjectAttributionConfig!(
    [{ billingAccountId: 'billing-1', skuIds: ['sku-1'], projectId: 'project-1' }],
    {
      billingAccountIds: ['BILLING-1'],
      projects: [
        { projectId: 'project-1', billable: true, activeCustomerIds: ['customer-1'] },
      ],
      existingMappings: [
        {
          ruleId: 'existing-rule',
          ruleName: 'Existing owner',
          billingAccountId: 'BILLING-1',
          skuId: 'sku-1',
          projectId: 'other-project',
        },
      ],
    }
  ),
  /Conflicting null-project attribution/,
  'Overlapping effective rules cannot map one Billing ID + SKU to different projects'
);

const plan = buildNullProjectAttributionPlan([
  {
    ruleId: 'rule-1',
    ruleName: 'Shared charges',
    billingAccountId: '01c462-ee4fd8-dd95a6',
    skuId: 'sku-1',
    projectId: 'shared-charges-project',
  },
]);

assert.deepEqual(
  plan.mappings,
  [
    {
      ruleId: 'rule-1',
      ruleName: 'Shared charges',
      billingAccountId: '01C462-EE4FD8-DD95A6',
      skuId: 'sku-1',
      projectId: 'shared-charges-project',
    },
  ],
  'The plan should expose normalized mappings for SQL and customer scoping'
);

assert.deepEqual(
  plan.resolve({
    billingAccountId: '01C462-EE4FD8-DD95A6',
    skuId: 'sku-1',
    projectId: null,
  }),
  {
    ruleId: 'rule-1',
    ruleName: 'Shared charges',
    projectId: 'shared-charges-project',
  },
  'An exact Billing ID + SKU match should resolve to the configured virtual project'
);

assert.equal(
  plan.resolve({
    billingAccountId: '01C462-EE4FD8-DD95A6',
    skuId: 'sku-1',
    projectId: 'real-gcp-project',
  }),
  null,
  'A real GCP project must never be overwritten by an attribution rule'
);

assert.throws(
  () => buildNullProjectAttributionPlan([
    {
      ruleId: 'rule-1',
      ruleName: 'First owner',
      billingAccountId: '01C462-EE4FD8-DD95A6',
      skuId: 'sku-1',
      projectId: 'customer-a-project',
    },
    {
      ruleId: 'rule-2',
      ruleName: 'Second owner',
      billingAccountId: '01c462-ee4fd8-dd95a6',
      skuId: 'sku-1',
      projectId: 'customer-b-project',
    },
  ]),
  /Conflicting null-project attribution/,
  'The same Billing ID + SKU cannot resolve to two projects'
);

assert.deepEqual(
  buildNullProjectAttributionPlan([
    {
      ruleId: 'rule-1',
      ruleName: 'First declaration',
      billingAccountId: 'BILLING-1',
      skuId: 'sku-1',
      projectId: 'shared-project',
    },
    {
      ruleId: 'rule-2',
      ruleName: 'Duplicate declaration',
      billingAccountId: 'BILLING-1',
      skuId: 'sku-1',
      projectId: 'shared-project',
    },
  ]).mappings,
  [{
    ruleId: 'rule-1',
    ruleName: 'First declaration',
    billingAccountId: 'BILLING-1',
    skuId: 'sku-1',
    projectId: 'shared-project',
  }],
  'Identical destinations should deduplicate while preserving the higher-priority first rule'
);

const prismaSchema = readFileSync(
  join(process.cwd(), 'prisma/schema.prisma'),
  'utf8'
);
assert(
  prismaSchema.includes('ASSIGN_NULL_PROJECT'),
  'SpecialRuleType must include ASSIGN_NULL_PROJECT'
);
assert(
  prismaSchema.includes('model SpecialRuleNullProjectMapping'),
  'Prisma must persist normalized Billing ID + SKU mappings'
);
assert(
  /model Invoice \{[\s\S]*?configSnapshotId\s+String\?/.test(prismaSchema),
  'Each invoice must reference the configuration snapshot used to create it'
);
assert(
  existsSync(join(
    process.cwd(),
    'prisma/migrations/20260818000100_null_project_attribution/migration.sql'
  )),
  'Null-project attribution migration must exist'
);

const loaderModulePath = join(
  process.cwd(),
  'src/lib/special-rules/null-project-attribution-store.ts'
);
assert(
  existsSync(loaderModulePath),
  'Null-project attribution database loader must exist'
);

const globalSpecialRulesRoute = readFileSync(
  join(process.cwd(), 'src/app/api/special-rules/route.ts'),
  'utf8'
);
const specialRuleDetailRoute = readFileSync(
  join(process.cwd(), 'src/app/api/special-rules/[id]/route.ts'),
  'utf8'
);
const customerSpecialRulesRoute = readFileSync(
  join(process.cwd(), 'src/app/api/customers/[id]/special-rules/route.ts'),
  'utf8'
);
assert(
  globalSpecialRulesRoute.includes('prepareNullProjectAttributionMappings'),
  'Global special-rule creation must validate and persist null-project mappings'
);
assert(
  specialRuleDetailRoute.includes('prepareNullProjectAttributionMappings'),
  'Special-rule updates must revalidate null-project mappings'
);
assert(
  customerSpecialRulesRoute.includes('ASSIGN_NULL_PROJECT rules must be global'),
  'Customer-scoped routes must reject pre-customer attribution rules'
);

const monthlyXlsxExporter = readFileSync(
  join(process.cwd(), 'src/lib/invoice-presentation/exporters/xlsx.ts'),
  'utf8'
);
const monthlyLinesRoute = readFileSync(
  join(process.cwd(), 'src/app/api/billing/monthly-lines/route.ts'),
  'utf8'
);
assert(
  monthlyXlsxExporter.includes('loadNullProjectAttributionPlan')
    && monthlyXlsxExporter.includes('attribution.project_id')
    && monthlyXlsxExporter.includes('line.subaccount_id IS NULL')
    && monthlyXlsxExporter.includes('UPPER(BTRIM(line.account_id))'),
  'Monthly billing SQL must resolve only NULL projects through the shared attribution plan'
);
assert(
  monthlyXlsxExporter.includes('snapshotNullProjectAttributionMappings')
    && monthlyXlsxExporter.includes('configSnapshot: true')
    && monthlyXlsxExporter.includes('attributionMappings:')
    && monthlyXlsxExporter.includes('snapshotProjectIds'),
  'Historical invoice exports must use the invoice configuration snapshot instead of live rules'
);
assert(
  monthlyLinesRoute.includes('ATTRIBUTION_CONFIG_INVALID'),
  'Monthly billing must return a specific conflict when attribution configuration is invalid'
);

const unifiedBillingEngine = readFileSync(
  join(process.cwd(), 'src/lib/billing/unified-engine.ts'),
  'utf8'
);
const specialRulesEngine = readFileSync(
  join(process.cwd(), 'src/lib/special-rules/engine.ts'),
  'utf8'
);
const specialRulesPage = readFileSync(
  join(process.cwd(), 'src/app/(console)/admin/special-rules/page.tsx'),
  'utf8'
);
assert(
  unifiedBillingEngine.includes('loadNullProjectAttributionPlan')
    && unifiedBillingEngine.includes('subaccountId: null')
    && unifiedBillingEngine.includes("mode: 'insensitive'")
    && unifiedBillingEngine.includes('nullProjectAttributionPlan.resolve'),
  'Unified invoice execution must route matching NULL-project rows before customer billing'
);
assert(
  unifiedBillingEngine.includes('configSnapshotId: configSnapshot.id'),
  'Generated invoices must reference their own configuration snapshot'
);
assert(
  specialRulesEngine.includes("ruleType: { not: 'ASSIGN_NULL_PROJECT' }"),
  'Cost transformation rules must exclude the pre-customer attribution rule type'
);
assert(
  unifiedBillingEngine.indexOf('recordSpecialRuleEffects(invoiceRunId, attributionRuleResults)')
    > unifiedBillingEngine.indexOf('const invoice = await prisma.$transaction'),
  'Attribution effects must only be recorded after an invoice has been created'
);
assert(
  specialRuleDetailRoute.includes('shouldValidateAttribution'),
  'An invalid active attribution rule must still be possible to disable without revalidation'
);
assert(
  specialRulesPage.includes("value: 'ASSIGN_NULL_PROJECT'")
    && specialRulesPage.includes('billingAccountId')
    && specialRulesPage.includes('skuIds')
    && specialRulesPage.includes('projectId'),
  'Operations UI must provide the new rule type and its grouped JSON template'
);
assert(
  specialRulesPage.includes("api.patch(`/special-rules/${editingRule.id}`")
    && specialRulesPage.includes('effectiveStart')
    && specialRulesPage.includes('GLOBAL_SCOPE'),
  'Operations UI must use the current PATCH/date API and force attribution rules to global scope'
);

const { createSpecialRuleSchema } = require(join(
  process.cwd(),
  'src/lib/utils/validation.ts'
)) as {
  createSpecialRuleSchema: {
    safeParse(input: unknown): { success: boolean; data?: unknown; error?: unknown };
  };
};

const validRule = createSpecialRuleSchema.safeParse({
  name: 'Shared non-project charges',
  ruleType: 'ASSIGN_NULL_PROJECT',
  config: [
    {
      billingAccountId: '01C462-EE4FD8-DD95A6',
      skuIds: ['sku-1', 'sku-2'],
      projectId: 'shared-charges-project',
    },
  ],
  effectiveStart: '2026-08-01',
});
assert(validRule.success, 'ASSIGN_NULL_PROJECT grouped JSON should pass request validation');

const reversedDateRule = createSpecialRuleSchema.safeParse({
  name: 'Invalid date range',
  ruleType: 'ASSIGN_NULL_PROJECT',
  config: [
    {
      billingAccountId: '01C462-EE4FD8-DD95A6',
      skuIds: ['sku-1'],
      projectId: 'shared-charges-project',
    },
  ],
  effectiveStart: '2026-09-01',
  effectiveEnd: '2026-08-01',
});
assert.equal(
  reversedDateRule.success,
  false,
  'A special rule cannot end before it starts'
);

void (async () => {
  const {
    loadNullProjectAttributionPlan,
    prepareNullProjectAttributionMappings,
  } = require(loaderModulePath) as {
    loadNullProjectAttributionPlan: (
      db: unknown,
      billingMonth: string
    ) => Promise<{
      resolve(input: {
        billingAccountId: string;
        skuId: string;
        projectId: string | null;
      }): { projectId: string } | null;
    }>;
    prepareNullProjectAttributionMappings?: (
      db: unknown,
      input: {
        config: Array<{ billingAccountId: string; skuIds: string[]; projectId: string }>;
        effectiveStart: Date | null;
        effectiveEnd: Date | null;
      }
    ) => Promise<Array<{ billingAccountId: string; skuId: string; projectId: string }>>;
  };

  const loadedPlan = await loadNullProjectAttributionPlan(
    {
      specialRule: {
        findMany: async () => [
          {
            id: 'rule-1',
            name: 'Shared charges',
            nullProjectMappings: [
              {
                billingAccountId: 'BILLING-1',
                skuId: 'sku-1',
                projectId: 'project-1',
                targetProject: {
                  billable: true,
                  customerProjects: [{ customerId: 'customer-1' }],
                },
              },
            ],
          },
        ],
      },
    },
    '2026-08'
  );
  assert.equal(
    loadedPlan.resolve({
      billingAccountId: 'BILLING-1',
      skuId: 'sku-1',
      projectId: null,
    })?.projectId,
    'project-1',
    'The loader should turn effective database rows into an attribution plan'
  );

  assert.equal(
    typeof prepareNullProjectAttributionMappings,
    'function',
    'Rule writes must validate database references and overlapping rules'
  );
  let overlapWhere: unknown;
  const preparedMappings = await prepareNullProjectAttributionMappings!(
    {
      billingAccount: {
        findMany: async () => [{ billingAccountId: 'BILLING-1' }],
      },
      projectBillingConfig: {
        findMany: async () => [
          {
            projectId: 'project-1',
            billable: true,
            customerProjects: [{ customerId: 'customer-1' }],
          },
        ],
      },
      specialRule: {
        findMany: async (args: { where: unknown }) => {
          overlapWhere = args.where;
          return [];
        },
      },
    },
    {
      config: [
        { billingAccountId: 'billing-1', skuIds: ['sku-1'], projectId: 'project-1' },
      ],
      effectiveStart: new Date('2026-08-15T00:00:00.000Z'),
      effectiveEnd: new Date('2026-08-20T00:00:00.000Z'),
    }
  );
  assert.deepEqual(
    preparedMappings,
    [{ billingAccountId: 'BILLING-1', skuId: 'sku-1', projectId: 'project-1' }],
    'A valid write should return normalized rows ready for createMany'
  );
  assert.match(
    JSON.stringify(overlapWhere),
    /2026-08-31T23:59:59\.999Z[\s\S]*2026-08-01T00:00:00\.000Z/,
    'Save-time conflicts must use whole-month envelopes because billing applies rules monthly'
  );

  console.log('null-project attribution tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
