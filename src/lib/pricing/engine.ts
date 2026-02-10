/**
 * Pricing Engine v1.0 (Phase 3)
 *
 * Converts raw GCP cost data into commercial pricing for invoices.
 *
 * Features:
 * - LIST_DISCOUNT rule type: Apply discount rate to raw cost
 * - SKU Group matching: Map SKUs to groups for rule selection
 * - Priority-based rule selection: Lower priority number wins
 * - Date range filtering: Rules can have effective date ranges
 * - Fallback to raw cost if no rules match
 *
 * Rule matching algorithm:
 * 1. Find all rules where effectiveStart <= billingMonth <= effectiveEnd (or null)
 * 2. Filter by skuGroupId (exact match or null for wildcard)
 * 3. Sort by priority (ascending), then specificity (exact > wildcard)
 * 4. Pick the first matching rule
 */

import { prisma } from '@/lib/db';
import { Prisma, PricingRuleType } from '@prisma/client';

/**
 * SKU Group mapping cache type
 */
export interface SkuGroupMapping {
  skuId: string; // Google SKU ID
  skuGroupId: string;
  skuGroupCode: string;
}

/**
 * Pricing rule definition
 */
export interface PricingRuleData {
  id: string;
  ruleType: PricingRuleType;
  discountRate: Prisma.Decimal;
  skuGroupId: string | null;
  skuGroupCode: string | null;
  effectiveStart: Date | null;
  effectiveEnd: Date | null;
  priority: number;
}

/**
 * Result of applying pricing to a cost entry
 */
export interface PricedEntry {
  rawCost: Prisma.Decimal;
  pricedCost: Prisma.Decimal;
  ruleId: string | null;
  ruleType: PricingRuleType | null;
  discountRate: Prisma.Decimal | null;
  skuGroupCode: string | null;
}

/**
 * Summary of pricing by SKU group
 */
export interface SkuGroupPricingSummary {
  skuGroupCode: string;
  rawTotal: string;
  pricedTotal: string;
  ruleId: string | null;
  discountRate: string | null;
  entryCount: number;
}

/**
 * Pricing engine result for a customer
 */
export interface CustomerPricingResult {
  customerId: string;
  pricingListId: string | null;
  rawTotal: Prisma.Decimal;
  pricedTotal: Prisma.Decimal;
  skuGroupSummary: Record<string, SkuGroupPricingSummary>;
  rulesUsed: Array<{
    ruleId: string;
    skuGroupCode: string | null;
    discountRate: string;
  }>;
}

const UNMAPPED_GROUP_CODE = 'UNMAPPED';

/**
 * Load SKU to SKU Group mappings
 * Returns a map: Google SKU ID -> { skuGroupId, skuGroupCode }
 */
export async function loadSkuGroupMappings(): Promise<Map<string, SkuGroupMapping>> {
  const mappings = await prisma.skuGroupMapping.findMany({
    include: {
      sku: { select: { skuId: true } },
      skuGroup: { select: { id: true, code: true } },
    },
  });

  const map = new Map<string, SkuGroupMapping>();
  for (const m of mappings) {
    map.set(m.sku.skuId, {
      skuId: m.sku.skuId,
      skuGroupId: m.skuGroup.id,
      skuGroupCode: m.skuGroup.code,
    });
  }

  return map;
}

/**
 * Load pricing rules for a customer's ACTIVE pricing list
 */
export async function loadPricingRules(customerId: string): Promise<{
  pricingListId: string | null;
  rules: PricingRuleData[];
}> {
  // Find customer's ACTIVE pricing list
  const pricingList = await prisma.pricingList.findFirst({
    where: {
      customerId,
      status: 'ACTIVE',
    },
    include: {
      pricingRules: {
        include: {
          skuGroup: { select: { code: true } },
        },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });

  if (!pricingList) {
    return { pricingListId: null, rules: [] };
  }

  const rules: PricingRuleData[] = pricingList.pricingRules.map((r) => ({
    id: r.id,
    ruleType: r.ruleType,
    discountRate: r.discountRate,
    skuGroupId: r.skuGroupId,
    skuGroupCode: r.skuGroup?.code ?? null,
    effectiveStart: r.effectiveStart,
    effectiveEnd: r.effectiveEnd,
    priority: r.priority,
  }));

  return { pricingListId: pricingList.id, rules };
}

/**
 * Check if a date falls within a rule's effective range
 */
function isRuleEffective(
  rule: PricingRuleData,
  billingMonthStart: Date,
  billingMonthEnd: Date
): boolean {
  // If no date constraints, rule is always effective
  if (!rule.effectiveStart && !rule.effectiveEnd) {
    return true;
  }

  // Rule starts after billing month ends
  if (rule.effectiveStart && rule.effectiveStart >= billingMonthEnd) {
    return false;
  }

  // Rule ends before billing month starts
  if (rule.effectiveEnd && rule.effectiveEnd < billingMonthStart) {
    return false;
  }

  return true;
}

/**
 * Find the best matching pricing rule for a SKU group
 *
 * Selection criteria (in order):
 * 1. Rule must be effective for the billing month
 * 2. Rule skuGroupId matches the entry's group OR is null (wildcard)
 * 3. Lower priority number wins
 * 4. Specific match (exact skuGroupId) beats wildcard (null)
 */
export function selectBestRule(
  skuGroupId: string | null,
  rules: PricingRuleData[],
  billingMonthStart: Date,
  billingMonthEnd: Date
): PricingRuleData | null {
  // Filter to effective rules that match this SKU group
  const candidates = rules.filter((rule) => {
    if (!isRuleEffective(rule, billingMonthStart, billingMonthEnd)) {
      return false;
    }

    // Rule applies if skuGroupId matches or rule is wildcard (null)
    if (rule.skuGroupId === null) {
      return true; // Wildcard rule
    }

    return rule.skuGroupId === skuGroupId;
  });

  if (candidates.length === 0) {
    return null;
  }

  // Sort by priority (ascending), then by specificity (specific > wildcard)
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // Specific match beats wildcard at same priority
    const aSpecific = a.skuGroupId !== null ? 0 : 1;
    const bSpecific = b.skuGroupId !== null ? 0 : 1;
    return aSpecific - bSpecific;
  });

  return candidates[0];
}

/**
 * Apply LIST_DISCOUNT rule to a cost entry
 *
 * LIST_DISCOUNT: final_cost = raw_cost * discountRate
 * - discountRate = 0.90 means customer pays 90% of list price (10% discount)
 * - discountRate = 1.00 means no discount (100% of list)
 * - discountRate = 0.85 means 15% discount
 */
function applyListDiscount(
  rawCost: Prisma.Decimal,
  discountRate: Prisma.Decimal
): Prisma.Decimal {
  return rawCost.mul(discountRate);
}

/**
 * Apply pricing to a single cost entry
 */
export function applyPricingToEntry(
  rawCost: Prisma.Decimal,
  skuGroupId: string | null,
  rules: PricingRuleData[],
  billingMonthStart: Date,
  billingMonthEnd: Date,
  skuGroupCode: string | null
): PricedEntry {
  const rule = selectBestRule(skuGroupId, rules, billingMonthStart, billingMonthEnd);

  if (!rule) {
    // No matching rule - use raw cost
    return {
      rawCost,
      pricedCost: rawCost,
      ruleId: null,
      ruleType: null,
      discountRate: null,
      skuGroupCode,
    };
  }

  let pricedCost: Prisma.Decimal;

  switch (rule.ruleType) {
    case 'LIST_DISCOUNT':
      pricedCost = applyListDiscount(rawCost, rule.discountRate);
      break;
    default:
      // Unknown rule type - use raw cost
      pricedCost = rawCost;
  }

  return {
    rawCost,
    pricedCost,
    ruleId: rule.id,
    ruleType: rule.ruleType,
    discountRate: rule.discountRate,
    skuGroupCode,
  };
}

/**
 * Main pricing function: Apply pricing rules to all cost entries for a customer
 *
 * @param customerId - Customer to price for
 * @param costEntries - Raw cost entries with skuId and cost
 * @param billingMonth - Billing month in YYYY-MM format
 * @returns Pricing result with totals and breakdown
 */
export async function applyPricingForCustomer(
  customerId: string,
  costEntries: Array<{ skuId: string; cost: Prisma.Decimal }>,
  billingMonth: string
): Promise<CustomerPricingResult> {
  // Parse billing month
  const [year, month] = billingMonth.split('-').map(Number);
  const billingMonthStart = new Date(Date.UTC(year, month - 1, 1));
  const billingMonthEnd = new Date(Date.UTC(year, month, 1));

  // Load SKU group mappings
  const skuGroupMappings = await loadSkuGroupMappings();

  // Load customer's pricing rules
  const { pricingListId, rules } = await loadPricingRules(customerId);

  // Track totals and breakdown
  let rawTotal = new Prisma.Decimal(0);
  let pricedTotal = new Prisma.Decimal(0);
  const skuGroupSummary: Record<string, SkuGroupPricingSummary> = {};
  const rulesUsedMap = new Map<string, { skuGroupCode: string | null; discountRate: string }>();

  // Process each entry
  for (const entry of costEntries) {
    // Lookup SKU group
    const mapping = skuGroupMappings.get(entry.skuId);
    const skuGroupId = mapping?.skuGroupId ?? null;
    const skuGroupCode = mapping?.skuGroupCode ?? UNMAPPED_GROUP_CODE;

    // Apply pricing
    const priced = applyPricingToEntry(
      entry.cost,
      skuGroupId,
      rules,
      billingMonthStart,
      billingMonthEnd,
      skuGroupCode
    );

    // Accumulate totals
    rawTotal = rawTotal.add(priced.rawCost);
    pricedTotal = pricedTotal.add(priced.pricedCost);

    // Track by SKU group
    if (!skuGroupSummary[skuGroupCode]) {
      skuGroupSummary[skuGroupCode] = {
        skuGroupCode,
        rawTotal: '0',
        pricedTotal: '0',
        ruleId: priced.ruleId,
        discountRate: priced.discountRate?.toString() ?? null,
        entryCount: 0,
      };
    }

    const groupSummary = skuGroupSummary[skuGroupCode];
    groupSummary.rawTotal = new Prisma.Decimal(groupSummary.rawTotal).add(priced.rawCost).toString();
    groupSummary.pricedTotal = new Prisma.Decimal(groupSummary.pricedTotal).add(priced.pricedCost).toString();
    groupSummary.entryCount++;

    // Track rules used
    if (priced.ruleId && !rulesUsedMap.has(priced.ruleId)) {
      rulesUsedMap.set(priced.ruleId, {
        skuGroupCode: priced.skuGroupCode,
        discountRate: priced.discountRate?.toString() ?? '1.0000',
      });
    }
  }

  // Convert rules used map to array
  const rulesUsed = Array.from(rulesUsedMap.entries()).map(([ruleId, data]) => ({
    ruleId,
    ...data,
  }));

  return {
    customerId,
    pricingListId,
    rawTotal,
    pricedTotal,
    skuGroupSummary,
    rulesUsed,
  };
}

/**
 * Create a config snapshot for the pricing rules used in an invoice run
 */
export interface PricingConfigSnapshot {
  pricingListId: string | null;
  rules: Array<{
    ruleId: string;
    ruleType: string;
    discountRate: string;
    skuGroupId: string | null;
    skuGroupCode: string | null;
    effectiveStart: string | null;
    effectiveEnd: string | null;
    priority: number;
  }>;
  capturedAt: string;
}

export async function capturePricingConfigSnapshot(
  customerId: string
): Promise<PricingConfigSnapshot> {
  const { pricingListId, rules } = await loadPricingRules(customerId);

  return {
    pricingListId,
    rules: rules.map((r) => ({
      ruleId: r.id,
      ruleType: r.ruleType,
      discountRate: r.discountRate.toString(),
      skuGroupId: r.skuGroupId,
      skuGroupCode: r.skuGroupCode,
      effectiveStart: r.effectiveStart?.toISOString() ?? null,
      effectiveEnd: r.effectiveEnd?.toISOString() ?? null,
      priority: r.priority,
    })),
    capturedAt: new Date().toISOString(),
  };
}
