/**
 * Special Rules Engine (Phase 3.5)
 *
 * Handles special rule matching and application during invoice runs.
 * Special rules are applied BEFORE pricing and credits.
 *
 * Rule Types:
 * - EXCLUDE_SKU: Remove specific SKU costs from billing
 * - EXCLUDE_SKU_GROUP: Remove entire SKU group costs from billing
 * - OVERRIDE_COST: Multiply cost by costMultiplier (0 = free)
 * - MOVE_TO_CUSTOMER: Re-assign costs to a different customer
 */

import { prisma } from '@/lib/db';
import { Prisma, SpecialRuleType } from '@prisma/client';

/**
 * Raw cost entry with SKU group mapping for rule matching
 */
export interface CostEntryForRules {
  id: string;
  billingAccountId: string;
  projectId: string;
  serviceId: string;
  skuId: string;
  skuGroupId?: string; // Resolved from SKU group mapping
  skuGroupCode?: string;
  cost: Prisma.Decimal;
  currency: string;
  usageStartTime: Date;
  usageEndTime: Date;
}

/**
 * Special rule loaded from database
 */
export interface LoadedSpecialRule {
  id: string;
  customerId: string | null;
  name: string;
  priority: number;
  ruleType: SpecialRuleType;
  matchSkuId: string | null;
  matchSkuGroupId: string | null;
  matchSkuGroupCode: string | null;
  matchServiceId: string | null;
  matchProjectId: string | null;
  matchBillingAccountId: string | null;
  costMultiplier: Prisma.Decimal | null;
  targetCustomerId: string | null;
  effectiveStart: Date | null;
  effectiveEnd: Date | null;
}

/**
 * Result of applying a single rule to cost entries
 */
export interface RuleApplicationResult {
  ruleId: string;
  ruleName: string;
  ruleType: SpecialRuleType;
  affectedRowCount: number;
  costDelta: Prisma.Decimal; // Negative = reduced, positive = increased
  summary: {
    byProject: Record<string, { count: number; delta: string }>;
    bySku: Record<string, { count: number; delta: string }>;
  };
}

/**
 * Result of applying all special rules to a customer's costs
 */
export interface SpecialRulesApplicationResult {
  // Transformed cost entries after rule application
  transformedEntries: CostEntryForRules[];
  // Entries that were excluded (for audit/logging)
  excludedEntries: CostEntryForRules[];
  // Entries to move to other customers (keyed by targetCustomerId)
  movedEntries: Map<string, CostEntryForRules[]>;
  // Per-rule application results
  ruleResults: RuleApplicationResult[];
  // Total cost impact
  totalCostDelta: Prisma.Decimal;
  // Rules applied (for config snapshot)
  rulesApplied: Array<{
    ruleId: string;
    ruleName: string;
    ruleType: string;
    priority: number;
  }>;
}

/**
 * Special rule config snapshot for reproducibility
 */
export interface SpecialRuleConfigSnapshot {
  ruleId: string;
  name: string;
  ruleType: string;
  priority: number;
  matchCriteria: {
    skuId: string | null;
    skuGroupId: string | null;
    serviceId: string | null;
    projectId: string | null;
    billingAccountId: string | null;
  };
  parameters: {
    costMultiplier: string | null;
    targetCustomerId: string | null;
  };
}

/**
 * Load applicable special rules for a customer.
 *
 * Rules are loaded in priority order (lower number = higher priority).
 * Global rules (customerId = null) are included and sorted together.
 *
 * @param customerId Customer ID
 * @param billingMonth YYYY-MM format for date filtering
 * @returns Rules sorted by priority
 */
export async function loadApplicableSpecialRules(
  customerId: string,
  billingMonth: string
): Promise<LoadedSpecialRule[]> {
  // Parse billing month to get date range for effective date filtering
  const [year, month] = billingMonth.split('-').map(Number);
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  // Load rules that apply to this customer or are global
  const rules = await prisma.specialRule.findMany({
    where: {
      AND: [
        // Customer scope: customer-specific OR global rules
        {
          OR: [
            { customerId: customerId },
            { customerId: null },
          ],
        },
        // Enabled and not deleted
        { enabled: true },
        { deletedAt: null },
        // Effective date filtering: rule validity overlaps with billing month
        {
          OR: [
            { effectiveStart: null, effectiveEnd: null },
            { effectiveStart: null, effectiveEnd: { gte: startOfMonth } },
            { effectiveEnd: null, effectiveStart: { lte: endOfMonth } },
            { effectiveStart: { lte: endOfMonth }, effectiveEnd: { gte: startOfMonth } },
          ],
        },
      ],
    },
    orderBy: { priority: 'asc' },
    include: {
      matchSkuGroup: {
        select: {
          id: true,
          code: true,
        },
      },
    },
  });

  return rules.map((rule) => ({
    id: rule.id,
    customerId: rule.customerId,
    name: rule.name,
    priority: rule.priority,
    ruleType: rule.ruleType,
    matchSkuId: rule.matchSkuId,
    matchSkuGroupId: rule.matchSkuGroupId,
    matchSkuGroupCode: rule.matchSkuGroup?.code ?? null,
    matchServiceId: rule.matchServiceId,
    matchProjectId: rule.matchProjectId,
    matchBillingAccountId: rule.matchBillingAccountId,
    costMultiplier: rule.costMultiplier,
    targetCustomerId: rule.targetCustomerId,
    effectiveStart: rule.effectiveStart,
    effectiveEnd: rule.effectiveEnd,
  }));
}

/**
 * Check if a cost entry matches a rule's criteria.
 *
 * All non-null match conditions must be satisfied (AND logic).
 */
function entryMatchesRule(entry: CostEntryForRules, rule: LoadedSpecialRule): boolean {
  // Check SKU ID match
  if (rule.matchSkuId !== null && entry.skuId !== rule.matchSkuId) {
    return false;
  }

  // Check SKU Group match
  if (rule.matchSkuGroupId !== null && entry.skuGroupId !== rule.matchSkuGroupId) {
    return false;
  }

  // Check Service ID match
  if (rule.matchServiceId !== null && entry.serviceId !== rule.matchServiceId) {
    return false;
  }

  // Check Project ID match
  if (rule.matchProjectId !== null && entry.projectId !== rule.matchProjectId) {
    return false;
  }

  // Check Billing Account ID match
  if (rule.matchBillingAccountId !== null && entry.billingAccountId !== rule.matchBillingAccountId) {
    return false;
  }

  return true;
}

/**
 * Apply special rules to a set of cost entries.
 *
 * Rules are applied in priority order. Each entry is only affected by
 * the first matching rule (no cascading).
 *
 * @param entries Cost entries to process
 * @param rules Applicable rules sorted by priority
 * @returns Application result with transformed entries and audit data
 */
export function applySpecialRules(
  entries: CostEntryForRules[],
  rules: LoadedSpecialRule[]
): SpecialRulesApplicationResult {
  const transformedEntries: CostEntryForRules[] = [];
  const excludedEntries: CostEntryForRules[] = [];
  const movedEntries = new Map<string, CostEntryForRules[]>();
  const ruleResults: RuleApplicationResult[] = [];
  let totalCostDelta = new Prisma.Decimal(0);

  // Track which rule affected each entry (for one-rule-per-entry logic)
  const entryRuleMap = new Map<string, string>(); // entryId -> ruleId

  // Initialize rule result trackers
  const ruleTrackers = new Map<string, {
    rule: LoadedSpecialRule;
    affectedRowCount: number;
    costDelta: Prisma.Decimal;
    byProject: Map<string, { count: number; delta: Prisma.Decimal }>;
    bySku: Map<string, { count: number; delta: Prisma.Decimal }>;
  }>();

  for (const rule of rules) {
    ruleTrackers.set(rule.id, {
      rule,
      affectedRowCount: 0,
      costDelta: new Prisma.Decimal(0),
      byProject: new Map(),
      bySku: new Map(),
    });
  }

  // Process each entry
  for (const entry of entries) {
    let wasProcessed = false;

    // Find first matching rule
    for (const rule of rules) {
      if (entryMatchesRule(entry, rule)) {
        const tracker = ruleTrackers.get(rule.id)!;
        const originalCost = entry.cost;
        let newCost = originalCost;
        let costDelta = new Prisma.Decimal(0);

        switch (rule.ruleType) {
          case 'EXCLUDE_SKU':
          case 'EXCLUDE_SKU_GROUP':
            // Exclude from billing - cost delta is the full cost being removed
            excludedEntries.push({ ...entry });
            costDelta = originalCost.neg();
            wasProcessed = true;
            break;

          case 'OVERRIDE_COST':
            if (rule.costMultiplier !== null) {
              newCost = originalCost.mul(rule.costMultiplier);
              costDelta = newCost.sub(originalCost);
              transformedEntries.push({ ...entry, cost: newCost });
              wasProcessed = true;
            }
            break;

          case 'MOVE_TO_CUSTOMER':
            if (rule.targetCustomerId) {
              // Move to target customer - original entry is excluded from this customer
              if (!movedEntries.has(rule.targetCustomerId)) {
                movedEntries.set(rule.targetCustomerId, []);
              }
              movedEntries.get(rule.targetCustomerId)!.push({ ...entry });
              costDelta = originalCost.neg(); // Cost is removed from this customer
              wasProcessed = true;
            }
            break;
        }

        if (wasProcessed) {
          // Update tracker
          tracker.affectedRowCount++;
          tracker.costDelta = tracker.costDelta.add(costDelta);
          totalCostDelta = totalCostDelta.add(costDelta);

          // Track by project
          const projectTrack = tracker.byProject.get(entry.projectId) ?? { count: 0, delta: new Prisma.Decimal(0) };
          projectTrack.count++;
          projectTrack.delta = projectTrack.delta.add(costDelta);
          tracker.byProject.set(entry.projectId, projectTrack);

          // Track by SKU
          const skuTrack = tracker.bySku.get(entry.skuId) ?? { count: 0, delta: new Prisma.Decimal(0) };
          skuTrack.count++;
          skuTrack.delta = skuTrack.delta.add(costDelta);
          tracker.bySku.set(entry.skuId, skuTrack);

          entryRuleMap.set(entry.id, rule.id);
          break; // Only apply first matching rule
        }
      }
    }

    // If no rule matched, keep entry as-is
    if (!wasProcessed) {
      transformedEntries.push({ ...entry });
    }
  }

  // Build rule results
  const rulesApplied: Array<{ ruleId: string; ruleName: string; ruleType: string; priority: number }> = [];

  ruleTrackers.forEach((tracker, ruleId) => {
    if (tracker.affectedRowCount > 0) {
      // Convert Maps to plain objects
      const byProject: Record<string, { count: number; delta: string }> = {};
      tracker.byProject.forEach((data, projectId) => {
        byProject[projectId] = { count: data.count, delta: data.delta.toString() };
      });

      const bySku: Record<string, { count: number; delta: string }> = {};
      tracker.bySku.forEach((data, skuId) => {
        bySku[skuId] = { count: data.count, delta: data.delta.toString() };
      });

      ruleResults.push({
        ruleId,
        ruleName: tracker.rule.name,
        ruleType: tracker.rule.ruleType,
        affectedRowCount: tracker.affectedRowCount,
        costDelta: tracker.costDelta,
        summary: { byProject, bySku },
      });

      rulesApplied.push({
        ruleId,
        ruleName: tracker.rule.name,
        ruleType: tracker.rule.ruleType,
        priority: tracker.rule.priority,
      });
    }
  });

  return {
    transformedEntries,
    excludedEntries,
    movedEntries,
    ruleResults,
    totalCostDelta,
    rulesApplied,
  };
}

/**
 * Record special rule effects in the ledger.
 *
 * @param invoiceRunId Invoice run ID
 * @param ruleResults Rule application results
 */
export async function recordSpecialRuleEffects(
  invoiceRunId: string,
  ruleResults: RuleApplicationResult[]
): Promise<void> {
  if (ruleResults.length === 0) {
    return;
  }

  await prisma.specialRuleEffectLedger.createMany({
    data: ruleResults.map((result) => ({
      invoiceRunId,
      ruleId: result.ruleId,
      affectedRowCount: result.affectedRowCount,
      costDelta: result.costDelta,
      summary: result.summary as Prisma.InputJsonValue,
    })),
  });
}

/**
 * Capture special rules config snapshot for reproducibility.
 *
 * @param customerId Customer ID
 * @param billingMonth Billing month
 * @returns Array of rule snapshots
 */
export async function captureSpecialRulesConfigSnapshot(
  customerId: string,
  billingMonth: string
): Promise<SpecialRuleConfigSnapshot[]> {
  const rules = await loadApplicableSpecialRules(customerId, billingMonth);

  return rules.map((rule) => ({
    ruleId: rule.id,
    name: rule.name,
    ruleType: rule.ruleType,
    priority: rule.priority,
    matchCriteria: {
      skuId: rule.matchSkuId,
      skuGroupId: rule.matchSkuGroupId,
      serviceId: rule.matchServiceId,
      projectId: rule.matchProjectId,
      billingAccountId: rule.matchBillingAccountId,
    },
    parameters: {
      costMultiplier: rule.costMultiplier?.toString() ?? null,
      targetCustomerId: rule.targetCustomerId,
    },
  }));
}

/**
 * Attach SKU group IDs to cost entries based on SKU group mappings.
 *
 * @param entries Cost entries
 * @param skuGroupMappings Map of skuId -> SkuGroupMapping (from pricing engine)
 * @returns Entries with skuGroupId populated
 */
export function attachSkuGroupsToEntries(
  entries: CostEntryForRules[],
  skuGroupMappings: Map<string, { skuId: string; skuGroupId: string; skuGroupCode: string }>
): CostEntryForRules[] {
  return entries.map((entry) => {
    const mapping = skuGroupMappings.get(entry.skuId);
    if (mapping) {
      return {
        ...entry,
        skuGroupId: mapping.skuGroupId,
        skuGroupCode: mapping.skuGroupCode,
      };
    }
    return entry;
  });
}
