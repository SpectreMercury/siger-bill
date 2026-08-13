import { Prisma } from '@prisma/client';

export type MonthlyBillingPriceBasis = 'STANDARD' | 'COST';
export const DEFAULT_MONTHLY_PRICING_BASIS: MonthlyBillingPriceBasis = 'STANDARD';

export function formatMonthlyNumericCell(value: Prisma.Decimal | null): number | null {
  if (value === null) return null;
  const number = Number(value.toDecimalPlaces(10).toString());
  return Object.is(number, -0) ? 0 : number;
}

export type MonthlyProviderCreditBreakdown = {
  type: string;
  amount: Prisma.Decimal;
  convertedAmount: Prisma.Decimal | null;
};

export type MonthlyBillingSourceRow = {
  id: string;
  accountId: string;
  billingAccountName: string | null;
  subaccountId: string | null;
  projectName: string | null;
  productId: string;
  serviceDescription: string | null;
  meterId: string;
  skuDescription: string | null;
  usageAmount: Prisma.Decimal;
  usageUnit: string;
  pricingUsageAmount: Prisma.Decimal | null;
  pricingUsageUnit: string | null;
  cost: Prisma.Decimal;
  listCost: Prisma.Decimal | null;
  creditAmount: Prisma.Decimal;
  creditBreakdown: MonthlyProviderCreditBreakdown[];
  costAfterCredit: Prisma.Decimal | null;
  currency: string;
  currencyConversionRate: Prisma.Decimal | null;
  transactionType: string | null;
  usageStartTime: Date;
  usageEndTime: Date;
};

export type MonthlyBillingGroup = MonthlyBillingSourceRow & {
  sourceRowCount: number;
  listCostConverted: Prisma.Decimal | null;
  resellerCostConverted: Prisma.Decimal | null;
  costAfterCreditConverted: Prisma.Decimal | null;
  pricingUsageAmountConverted: Prisma.Decimal | null;
};

type MutableMonthlyBillingGroup = MonthlyBillingGroup & {
  hasCompleteConversionRate: boolean;
};

export type MonthlyBillingAccumulator = Map<string, MutableMonthlyBillingGroup>;

export function createMonthlyBillingAccumulator(): MonthlyBillingAccumulator {
  return new Map();
}

function groupKey(row: MonthlyBillingSourceRow): string {
  return JSON.stringify([
    row.accountId,
    row.subaccountId ?? '',
    row.productId,
    row.meterId,
  ]);
}

function earlier(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function later(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}

/**
 * Merge one normalized billing row into the customer-facing monthly grouping.
 * The grouping key intentionally matches the billing template requirement:
 * billing account + project + service + SKU. Time is aggregated separately.
 */
export function accumulateMonthlyBillingRow(
  accumulator: MonthlyBillingAccumulator,
  row: MonthlyBillingSourceRow
): void {
  const key = groupKey(row);
  const existing = accumulator.get(key);

  if (!existing) {
    const hasCompleteConversionRate = row.currencyConversionRate != null;
    const listAmount = row.listCost ?? row.cost.sub(row.creditAmount);
    const costAfterCredit = row.costAfterCredit ?? row.cost.add(row.creditAmount);
    const pricingUsageAmount = row.pricingUsageAmount ?? row.usageAmount;
    accumulator.set(key, {
      ...row,
      listCost: listAmount,
      costAfterCredit,
      pricingUsageAmount,
      sourceRowCount: 1,
      listCostConverted: hasCompleteConversionRate
        ? listAmount.mul(row.currencyConversionRate!)
        : null,
      resellerCostConverted: hasCompleteConversionRate
        ? row.cost.mul(row.currencyConversionRate!)
        : null,
      costAfterCreditConverted: hasCompleteConversionRate
        ? costAfterCredit.mul(row.currencyConversionRate!)
        : null,
      creditBreakdown: row.creditBreakdown.map((credit) => ({ ...credit })),
      pricingUsageAmountConverted: hasCompleteConversionRate
        ? pricingUsageAmount.mul(row.currencyConversionRate!)
        : null,
      hasCompleteConversionRate,
    });
    return;
  }

  existing.sourceRowCount += 1;
  existing.billingAccountName ??= row.billingAccountName;
  existing.projectName ??= row.projectName;
  existing.serviceDescription ??= row.serviceDescription;
  existing.skuDescription ??= row.skuDescription;
  existing.pricingUsageUnit ??= row.pricingUsageUnit;
  existing.currencyConversionRate ??= row.currencyConversionRate;
  existing.transactionType ??= row.transactionType;
  existing.usageAmount = existing.usageAmount.add(row.usageAmount);
  existing.cost = existing.cost.add(row.cost);
  existing.creditAmount = existing.creditAmount.add(row.creditAmount);
  for (const credit of row.creditBreakdown) {
    const current = existing.creditBreakdown.find((item) => item.type === credit.type);
    if (!current) {
      existing.creditBreakdown.push({ ...credit });
      continue;
    }
    current.amount = current.amount.add(credit.amount);
    current.convertedAmount = current.convertedAmount != null && credit.convertedAmount != null
      ? current.convertedAmount.add(credit.convertedAmount)
      : null;
  }
  existing.pricingUsageAmount = existing.pricingUsageAmount!
    .add(row.pricingUsageAmount ?? row.usageAmount);
  existing.listCost = existing.listCost!
    .add(row.listCost ?? row.cost.sub(row.creditAmount));
  existing.costAfterCredit = existing.costAfterCredit!
    .add(row.costAfterCredit ?? row.cost.add(row.creditAmount));

  if (existing.hasCompleteConversionRate && row.currencyConversionRate != null) {
    const listAmount = row.listCost ?? row.cost.sub(row.creditAmount);
    const costAfterCredit = row.costAfterCredit ?? row.cost.add(row.creditAmount);
    const pricingUsageAmount = row.pricingUsageAmount ?? row.usageAmount;
    existing.listCostConverted = existing.listCostConverted!
      .add(listAmount.mul(row.currencyConversionRate));
    existing.resellerCostConverted = existing.resellerCostConverted!
      .add(row.cost.mul(row.currencyConversionRate));
    existing.costAfterCreditConverted = existing.costAfterCreditConverted!
      .add(costAfterCredit.mul(row.currencyConversionRate));
    existing.pricingUsageAmountConverted = existing.pricingUsageAmountConverted!
      .add(pricingUsageAmount.mul(row.currencyConversionRate));
  } else {
    existing.hasCompleteConversionRate = false;
    existing.listCostConverted = null;
    existing.resellerCostConverted = null;
    existing.costAfterCreditConverted = null;
    existing.pricingUsageAmountConverted = null;
  }

  existing.usageStartTime = earlier(existing.usageStartTime, row.usageStartTime);
  existing.usageEndTime = later(existing.usageEndTime, row.usageEndTime);
}

export function finalizeMonthlyBillingGroups(
  accumulator: MonthlyBillingAccumulator
): MonthlyBillingGroup[] {
  return Array.from(accumulator.values())
    .map((group) => ({
      id: group.id,
      accountId: group.accountId,
      billingAccountName: group.billingAccountName,
      subaccountId: group.subaccountId,
      projectName: group.projectName,
      productId: group.productId,
      serviceDescription: group.serviceDescription,
      meterId: group.meterId,
      skuDescription: group.skuDescription,
      usageAmount: group.usageAmount,
      usageUnit: group.usageUnit,
      pricingUsageAmount: group.pricingUsageAmount,
      pricingUsageUnit: group.pricingUsageUnit,
      cost: group.cost,
      listCost: group.listCost,
      creditAmount: group.creditAmount,
      creditBreakdown: group.creditBreakdown,
      costAfterCredit: group.costAfterCredit,
      currency: group.currency,
      currencyConversionRate: group.currencyConversionRate,
      transactionType: group.transactionType,
      usageStartTime: group.usageStartTime,
      usageEndTime: group.usageEndTime,
      sourceRowCount: group.sourceRowCount,
      listCostConverted: group.hasCompleteConversionRate ? group.listCostConverted : null,
      resellerCostConverted: group.hasCompleteConversionRate
        ? group.resellerCostConverted
        : null,
      costAfterCreditConverted: group.hasCompleteConversionRate
        ? group.costAfterCreditConverted
        : null,
      pricingUsageAmountConverted: group.hasCompleteConversionRate
        ? group.pricingUsageAmountConverted
        : null,
    }))
    .sort((left, right) => (
      left.usageStartTime.getTime() - right.usageStartTime.getTime()
      || (left.subaccountId ?? '').localeCompare(right.subaccountId ?? '')
      || left.productId.localeCompare(right.productId)
      || left.meterId.localeCompare(right.meterId)
      || left.accountId.localeCompare(right.accountId)
    ));
}

export function calculateMonthlyBillingAmounts(params: {
  priceBasis: MonthlyBillingPriceBasis;
  listAmount: Prisma.Decimal;
  resellerCost: Prisma.Decimal;
  providerCreditAmount: Prisma.Decimal;
  multiplier: Prisma.Decimal;
  discountedAmount?: Prisma.Decimal;
}): {
  voucherAmount: Prisma.Decimal;
  amountAfterCredit: Prisma.Decimal;
  finalAmount: Prisma.Decimal;
} {
  const baseAmount = params.priceBasis === 'STANDARD'
    ? params.listAmount
    : params.resellerCost;
  const discountedAmount = params.discountedAmount ?? baseAmount.mul(params.multiplier);
  // STANDARD invoices rebase the upstream BigQuery credit onto the amount
  // billed to the customer: credit / provider cost * discounted amount.
  const voucherAmount = params.priceBasis === 'STANDARD'
    ? params.resellerCost.isZero()
      ? new Prisma.Decimal(0)
      : params.providerCreditAmount.div(params.resellerCost).mul(discountedAmount)
    : params.providerCreditAmount;
  const amountAfterCredit = baseAmount.add(voucherAmount);

  return {
    voucherAmount,
    amountAfterCredit,
    finalAmount: params.priceBasis === 'STANDARD'
      ? discountedAmount.add(voucherAmount)
      : amountAfterCredit.mul(params.multiplier),
  };
}

export type MonthlyCustomerCreditConfig = {
  id: string;
  types: string[];
  remainingAmount: Prisma.Decimal;
  currency: string;
  billingAccountId: string | null;
  matchSkuId: string | null;
  matchSkuGroupId: string | null;
  matchProjectId: string | null;
};

type MonthlyProviderCreditAllocationInput = {
  accountId: string;
  projectId: string | null;
  skuId: string;
  skuGroupIds: string[];
  currency: string;
  breakdown: MonthlyProviderCreditBreakdown[];
};

type MonthlyProviderCreditAllocation = {
  amount: Prisma.Decimal;
  convertedAmount: Prisma.Decimal | null;
};

function creditConfigMatches(
  config: MonthlyCustomerCreditConfig,
  input: MonthlyProviderCreditAllocationInput
): boolean {
  if (config.currency !== input.currency) return false;
  if (config.billingAccountId != null && config.billingAccountId !== input.accountId) return false;
  if (config.matchProjectId != null && config.matchProjectId !== input.projectId) return false;
  if (config.matchSkuId != null && config.matchSkuId !== input.skuId) return false;
  if (config.matchSkuGroupId != null && !input.skuGroupIds.includes(config.matchSkuGroupId)) return false;
  return true;
}

/**
 * Allocate only the upstream GCP credit categories configured for a customer.
 * The allocator is stateful so a configured remaining balance caps the whole
 * monthly result instead of being re-applied independently to every row.
 */
export function createMonthlyProviderCreditAllocator(configs: MonthlyCustomerCreditConfig[]): {
  allocate(input: MonthlyProviderCreditAllocationInput): MonthlyProviderCreditAllocation;
} {
  const orderedConfigs = [...configs];
  const remainingById = new Map(
    orderedConfigs.map((config) => [config.id, config.remainingAmount])
  );

  return {
    allocate(input) {
      let amount = new Prisma.Decimal(0);
      let convertedAmount = new Prisma.Decimal(0);
      let hasCompleteConvertedAmount = true;

      const orderedBreakdown = [...input.breakdown]
        .sort((left, right) => left.type.localeCompare(right.type));
      for (const credit of orderedBreakdown) {
        if (credit.amount.isZero()) continue;
        const matchingConfigs = orderedConfigs.filter((config) => (
          config.types.includes(credit.type)
          && creditConfigMatches(config, input)
        ));
        if (matchingConfigs.length === 0) continue;

        if (credit.amount.gt(0)) {
          amount = amount.add(credit.amount);
          if (credit.convertedAmount == null) {
            hasCompleteConvertedAmount = false;
          } else {
            convertedAmount = convertedAmount.add(credit.convertedAmount);
          }
          continue;
        }

        let unallocated = credit.amount.abs();
        for (const config of matchingConfigs) {
          if (unallocated.isZero()) break;
          const remaining = remainingById.get(config.id) ?? new Prisma.Decimal(0);
          if (remaining.lte(0)) continue;

          const applied = Prisma.Decimal.min(unallocated, remaining);
          amount = amount.sub(applied);
          remainingById.set(config.id, remaining.sub(applied));
          unallocated = unallocated.sub(applied);

          if (credit.convertedAmount == null) {
            hasCompleteConvertedAmount = false;
          } else {
            convertedAmount = convertedAmount.add(
              credit.convertedAmount.mul(applied.div(credit.amount.abs()))
            );
          }
        }
      }

      return {
        amount,
        convertedAmount: hasCompleteConvertedAmount ? convertedAmount : null,
      };
    },
  };
}

type MonthlyPricingTier = {
  from: number;
  to?: number | null;
  rate?: number | null;
};

export function selectMonthlyPricingMultiplier(params: {
  ruleType: 'LIST_DISCOUNT' | 'UNIT_PRICE' | 'TIERED' | null;
  baseAmount: Prisma.Decimal;
  discountRate: Prisma.Decimal | null;
  tiers: MonthlyPricingTier[] | null;
}): Prisma.Decimal {
  if (params.ruleType === 'LIST_DISCOUNT' && params.discountRate != null) {
    return params.discountRate;
  }
  if (params.ruleType !== 'TIERED' || !Array.isArray(params.tiers)) {
    return new Prisma.Decimal(1);
  }

  const amount = Number(params.baseAmount.toString());
  const tier = params.tiers.find((candidate) => (
    amount >= candidate.from
    && (candidate.to == null || amount < candidate.to)
  ));
  return tier?.rate != null ? new Prisma.Decimal(tier.rate) : new Prisma.Decimal(1);
}
