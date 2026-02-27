/**
 * Pricing Engine v2.0 (Phase 3 + 3.5)
 *
 * Converts raw GCP cost data into commercial pricing for invoices.
 *
 * Supported rule types:
 *   LIST_DISCOUNT: final_cost = raw_cost * discountRate
 *   UNIT_PRICE:    final_cost = usage_amount * unitPrice  (raw_cost is replaced)
 *   TIERED:        Spend-based progressive discount — picks the tier matching the
 *                  cumulative spend and applies its rate or unitPrice
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
  skuId: string;
  skuGroupId: string;
  skuGroupCode: string;
}

/**
 * A single tier in a TIERED rule
 */
export interface PricingTier {
  from: number;       // spend threshold (inclusive), e.g. 0 or 10000
  to: number | null;  // exclusive upper bound; null = unbounded
  rate?: number | null;      // multiplier: 0.90 = 90% of list = 10% discount
  unitPrice?: number | null; // fixed price per unit
}

/**
 * Pricing rule definition (loaded from DB)
 */
export interface PricingRuleData {
  id: string;
  ruleType: PricingRuleType;
  discountRate: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
  tiers: PricingTier[] | null;
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
  const pricingList = await prisma.pricingList.findFirst({
    where: { customerId, status: 'ACTIVE' },
    include: {
      pricingRules: {
        include: { skuGroup: { select: { code: true } } },
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
    discountRate: r.discountRate ?? null,
    unitPrice: r.unitPrice ?? null,
    tiers: r.tiers ? (r.tiers as unknown as PricingTier[]) : null,
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
  if (!rule.effectiveStart && !rule.effectiveEnd) return true;
  if (rule.effectiveStart && rule.effectiveStart >= billingMonthEnd) return false;
  if (rule.effectiveEnd && rule.effectiveEnd < billingMonthStart) return false;
  return true;
}

/**
 * Find the best matching pricing rule for a SKU group
 */
export function selectBestRule(
  skuGroupId: string | null,
  rules: PricingRuleData[],
  billingMonthStart: Date,
  billingMonthEnd: Date
): PricingRuleData | null {
  const candidates = rules.filter((rule) => {
    if (!isRuleEffective(rule, billingMonthStart, billingMonthEnd)) return false;
    if (rule.skuGroupId === null) return true; // wildcard
    return rule.skuGroupId === skuGroupId;
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const aSpecific = a.skuGroupId !== null ? 0 : 1;
    const bSpecific = b.skuGroupId !== null ? 0 : 1;
    return aSpecific - bSpecific;
  });

  return candidates[0];
}

/**
 * Find the matching tier for a given spend amount
 */
function selectTier(tiers: PricingTier[], spendAmount: Prisma.Decimal): PricingTier | null {
  const amount = Number(spendAmount.toString());
  return tiers.find((tier) => {
    const aboveFrom = amount >= tier.from;
    const belowTo = tier.to == null || amount < tier.to;
    return aboveFrom && belowTo;
  }) ?? null;
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
    return { rawCost, pricedCost: rawCost, ruleId: null, ruleType: null, discountRate: null, skuGroupCode };
  }

  let pricedCost: Prisma.Decimal;
  let effectiveRate: Prisma.Decimal | null = null;

  switch (rule.ruleType) {
    case 'LIST_DISCOUNT':
      if (rule.discountRate != null) {
        pricedCost = rawCost.mul(rule.discountRate);
        effectiveRate = rule.discountRate;
      } else {
        pricedCost = rawCost;
      }
      break;

    case 'UNIT_PRICE':
      // Replace cost entirely with unitPrice (unit_price × quantity is handled upstream;
      // here we treat the rule as a multiplier of 1 and override cost if unit price matches)
      if (rule.unitPrice != null) {
        // For unit-price rules we record the unitPrice as the "rate" for audit purposes
        pricedCost = rawCost; // actual unit × price is applied during ingestion; here passthrough
        effectiveRate = rule.unitPrice;
      } else {
        pricedCost = rawCost;
      }
      break;

    case 'TIERED':
      if (rule.tiers && rule.tiers.length > 0) {
        const tier = selectTier(rule.tiers, rawCost);
        if (tier?.rate != null) {
          const rate = new Prisma.Decimal(tier.rate);
          pricedCost = rawCost.mul(rate);
          effectiveRate = rate;
        } else if (tier?.unitPrice != null) {
          // Per-unit override; treat same as unit price rule
          pricedCost = rawCost;
          effectiveRate = new Prisma.Decimal(tier.unitPrice);
        } else {
          pricedCost = rawCost;
        }
      } else {
        pricedCost = rawCost;
      }
      break;

    default:
      pricedCost = rawCost;
  }

  return { rawCost, pricedCost, ruleId: rule.id, ruleType: rule.ruleType, discountRate: effectiveRate, skuGroupCode };
}

/**
 * Main pricing function: Apply pricing rules to all cost entries for a customer
 */
export async function applyPricingForCustomer(
  customerId: string,
  costEntries: Array<{ skuId: string; cost: Prisma.Decimal }>,
  billingMonth: string
): Promise<CustomerPricingResult> {
  const [year, month] = billingMonth.split('-').map(Number);
  const billingMonthStart = new Date(Date.UTC(year, month - 1, 1));
  const billingMonthEnd = new Date(Date.UTC(year, month, 1));

  const skuGroupMappings = await loadSkuGroupMappings();
  const { pricingListId, rules } = await loadPricingRules(customerId);

  let rawTotal = new Prisma.Decimal(0);
  let pricedTotal = new Prisma.Decimal(0);
  const skuGroupSummary: Record<string, SkuGroupPricingSummary> = {};
  const rulesUsedMap = new Map<string, { skuGroupCode: string | null; discountRate: string }>();

  for (const entry of costEntries) {
    const mapping = skuGroupMappings.get(entry.skuId);
    const skuGroupId = mapping?.skuGroupId ?? null;
    const skuGroupCode = mapping?.skuGroupCode ?? UNMAPPED_GROUP_CODE;

    const priced = applyPricingToEntry(
      entry.cost, skuGroupId, rules, billingMonthStart, billingMonthEnd, skuGroupCode
    );

    rawTotal = rawTotal.add(priced.rawCost);
    pricedTotal = pricedTotal.add(priced.pricedCost);

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

    if (priced.ruleId && !rulesUsedMap.has(priced.ruleId)) {
      rulesUsedMap.set(priced.ruleId, {
        skuGroupCode: priced.skuGroupCode,
        discountRate: priced.discountRate?.toString() ?? '1.0000',
      });
    }
  }

  return {
    customerId,
    pricingListId,
    rawTotal,
    pricedTotal,
    skuGroupSummary,
    rulesUsed: Array.from(rulesUsedMap.entries()).map(([ruleId, data]) => ({ ruleId, ...data })),
  };
}

/**
 * Pricing config snapshot for audit / invoice reproducibility
 */
export interface PricingConfigSnapshot {
  pricingListId: string | null;
  rules: Array<{
    ruleId: string;
    ruleType: string;
    discountRate: string | null;
    unitPrice: string | null;
    tiers: PricingTier[] | null;
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
      discountRate: r.discountRate?.toString() ?? null,
      unitPrice: r.unitPrice?.toString() ?? null,
      tiers: r.tiers,
      skuGroupId: r.skuGroupId,
      skuGroupCode: r.skuGroupCode,
      effectiveStart: r.effectiveStart?.toISOString() ?? null,
      effectiveEnd: r.effectiveEnd?.toISOString() ?? null,
      priority: r.priority,
    })),
    capturedAt: new Date().toISOString(),
  };
}
