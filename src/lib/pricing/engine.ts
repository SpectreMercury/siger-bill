/**
 * Pricing Engine v3.0 (Phase 3 + 3.5 + Rule Revamp)
 *
 * Converts raw GCP cost data into commercial pricing for invoices.
 *
 * Rule model (post-revamp):
 * - Each PricingList has exactly one default rule (isDefault=true) plus zero
 *   or more explicit rules.
 * - A SkuGroup is covered by exactly one rule per list (DB-enforced via
 *   `pricing_rule_sku_groups.@@unique([pricingListId, skuGroupId])`).
 * - Engine selection: find the rule whose `skuGroups` includes the SKU's
 *   group → fall back to the default rule when not found (e.g. UNMAPPED).
 *
 * Supported rule types:
 *   LIST_DISCOUNT: final_cost = raw_cost * discountRate
 *   UNIT_PRICE:    final_cost = usage_amount * unitPrice  (raw_cost is replaced)
 *   TIERED:        Spend-based progressive discount.
 */

import { prisma } from '@/lib/db';
import { Prisma, PricingRuleType } from '@prisma/client';

export interface SkuGroupMapping {
  skuId: string;
  skuGroupId: string;
  skuGroupCode: string;
}

export interface PricingTier {
  from: number;
  to: number | null;
  rate?: number | null;
  unitPrice?: number | null;
}

export interface PricingRuleData {
  id: string;
  isDefault: boolean;
  ruleType: PricingRuleType;
  discountRate: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
  tiers: PricingTier[] | null;
  skuGroupIds: string[];     // empty for default rule when covering nothing; engine falls back regardless
  skuGroupCodes: string[];
  effectiveStart: Date | null;
  effectiveEnd: Date | null;
}

export interface PricedEntry {
  rawCost: Prisma.Decimal;
  pricedCost: Prisma.Decimal;
  ruleId: string | null;
  ruleType: PricingRuleType | null;
  discountRate: Prisma.Decimal | null;
  skuGroupCode: string | null;
}

export interface SkuGroupPricingSummary {
  skuGroupCode: string;
  rawTotal: string;
  pricedTotal: string;
  ruleId: string | null;
  discountRate: string | null;
  entryCount: number;
}

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
        include: {
          skuGroups: { include: { skuGroup: { select: { id: true, code: true } } } },
        },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      },
    },
  });

  if (!pricingList) {
    return { pricingListId: null, rules: [] };
  }

  const rules: PricingRuleData[] = pricingList.pricingRules.map((r) => ({
    id: r.id,
    isDefault: r.isDefault,
    ruleType: r.ruleType,
    discountRate: r.discountRate ?? null,
    unitPrice: r.unitPrice ?? null,
    tiers: r.tiers ? (r.tiers as unknown as PricingTier[]) : null,
    skuGroupIds: r.skuGroups.map((g) => g.skuGroup.id),
    skuGroupCodes: r.skuGroups.map((g) => g.skuGroup.code),
    effectiveStart: r.effectiveStart,
    effectiveEnd: r.effectiveEnd,
  }));

  return { pricingListId: pricingList.id, rules };
}

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
 * Find the rule that covers a given SKU group within the customer's pricing list.
 *
 * Order:
 *   1. Effective explicit rule whose `skuGroupIds` includes the group.
 *   2. Effective default rule (covers anything not in an explicit rule).
 *   3. null (no pricing list, or all rules outside effective window).
 */
export function selectBestRule(
  skuGroupId: string | null,
  rules: PricingRuleData[],
  billingMonthStart: Date,
  billingMonthEnd: Date
): PricingRuleData | null {
  // Explicit rules first
  if (skuGroupId) {
    for (const rule of rules) {
      if (rule.isDefault) continue;
      if (!isRuleEffective(rule, billingMonthStart, billingMonthEnd)) continue;
      if (rule.skuGroupIds.includes(skuGroupId)) return rule;
    }
  }
  // Default fallback
  const defaultRule = rules.find((r) => r.isDefault);
  if (defaultRule && isRuleEffective(defaultRule, billingMonthStart, billingMonthEnd)) {
    return defaultRule;
  }
  return null;
}

function selectTier(tiers: PricingTier[], spendAmount: Prisma.Decimal): PricingTier | null {
  const amount = Number(spendAmount.toString());
  return tiers.find((tier) => {
    const aboveFrom = amount >= tier.from;
    const belowTo = tier.to == null || amount < tier.to;
    return aboveFrom && belowTo;
  }) ?? null;
}

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
      if (rule.unitPrice != null) {
        pricedCost = rawCost;
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
    isDefault: boolean;
    ruleType: string;
    discountRate: string | null;
    unitPrice: string | null;
    tiers: PricingTier[] | null;
    skuGroupIds: string[];
    skuGroupCodes: string[];
    effectiveStart: string | null;
    effectiveEnd: string | null;
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
      isDefault: r.isDefault,
      ruleType: r.ruleType,
      discountRate: r.discountRate?.toString() ?? null,
      unitPrice: r.unitPrice?.toString() ?? null,
      tiers: r.tiers,
      skuGroupIds: r.skuGroupIds,
      skuGroupCodes: r.skuGroupCodes,
      effectiveStart: r.effectiveStart?.toISOString() ?? null,
      effectiveEnd: r.effectiveEnd?.toISOString() ?? null,
    })),
    capturedAt: new Date().toISOString(),
  };
}
