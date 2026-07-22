import { Prisma } from '@prisma/client';

export type EditableCreditStatus = 'ACTIVE' | 'EXPIRED' | 'DEPLETED';

export type ExistingCreditForUpdate = {
  types: readonly string[];
  totalAmount: Prisma.Decimal;
  remainingAmount: Prisma.Decimal;
  validFrom: Date;
  validTo: Date;
  status: EditableCreditStatus;
  allowCarryOver: boolean;
  description: string | null;
  matchSkuId: string | null;
  matchSkuGroupId: string | null;
  matchProjectId: string | null;
};

export type CreditUpdatePatch = {
  types?: string[];
  totalAmount?: string;
  remainingAmount?: string;
  adjustmentReason?: string;
  validFrom?: string;
  validTo?: string;
  status?: EditableCreditStatus;
  allowCarryOver?: boolean;
  description?: string | null;
  matchSkuId?: string | null;
  matchSkuGroupId?: string | null;
  matchProjectId?: string | null;
};

export type CreditUpdateResult =
  | {
      ok: true;
      updateData: Record<string, unknown>;
      beforeData: Record<string, unknown>;
      afterData: Record<string, unknown>;
      balanceAdjustment?: {
        amountDelta: string;
        remainingBefore: string;
        remainingAfter: string;
        reason: string;
      };
    }
  | { ok: false; error: string };

function formatDate(value: Date): string {
  return value.toISOString().split('T')[0];
}

function parseDate(value: string): Date | null {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatDate(date) !== value) return null;
  return date;
}

function recordChange(
  updateData: Record<string, unknown>,
  beforeData: Record<string, unknown>,
  afterData: Record<string, unknown>,
  field: string,
  before: unknown,
  after: unknown,
  updateValue: unknown = after
): void {
  updateData[field] = updateValue;
  beforeData[field] = before;
  afterData[field] = after;
}

export function buildCreditUpdate(
  existing: ExistingCreditForUpdate,
  patch: CreditUpdatePatch
): CreditUpdateResult {
  const validFrom = patch.validFrom ? parseDate(patch.validFrom) : existing.validFrom;
  const validTo = patch.validTo ? parseDate(patch.validTo) : existing.validTo;
  if (!validFrom || !validTo) {
    return { ok: false, error: 'Credit dates must be valid calendar dates' };
  }
  if (validTo <= validFrom) {
    return { ok: false, error: 'validTo must be after validFrom' };
  }

  const totalAmount = patch.totalAmount === undefined
    ? existing.totalAmount
    : new Prisma.Decimal(patch.totalAmount);
  const remainingAmount = patch.remainingAmount === undefined
    ? existing.remainingAmount
    : new Prisma.Decimal(patch.remainingAmount);
  if (remainingAmount.gt(totalAmount)) {
    return { ok: false, error: 'remainingAmount cannot exceed totalAmount' };
  }

  const balanceChanged = !remainingAmount.eq(existing.remainingAmount);
  const adjustmentReason = patch.adjustmentReason?.trim() ?? '';
  if (balanceChanged && !adjustmentReason) {
    return {
      ok: false,
      error: 'Balance adjustment reason is required when remainingAmount changes',
    };
  }

  let status = patch.status ?? existing.status;
  if (patch.status === undefined && patch.remainingAmount !== undefined) {
    if (remainingAmount.isZero()) status = 'DEPLETED';
    else if (existing.status === 'DEPLETED') status = 'ACTIVE';
  }
  if (status === 'ACTIVE' && remainingAmount.lte(0)) {
    return { ok: false, error: 'ACTIVE credit must have a positive remainingAmount' };
  }
  if (status === 'DEPLETED' && !remainingAmount.isZero()) {
    return { ok: false, error: 'DEPLETED credit must have remainingAmount equal to 0' };
  }

  const updateData: Record<string, unknown> = {};
  const beforeData: Record<string, unknown> = {};
  const afterData: Record<string, unknown> = {};

  if (patch.types !== undefined) {
    recordChange(updateData, beforeData, afterData, 'types', [...existing.types], patch.types);
  }
  if (patch.totalAmount !== undefined) {
    recordChange(
      updateData,
      beforeData,
      afterData,
      'totalAmount',
      existing.totalAmount.toString(),
      totalAmount.toString(),
      totalAmount
    );
  }
  if (patch.remainingAmount !== undefined) {
    recordChange(
      updateData,
      beforeData,
      afterData,
      'remainingAmount',
      existing.remainingAmount.toString(),
      remainingAmount.toString(),
      remainingAmount
    );
  }
  if (patch.validFrom !== undefined) {
    recordChange(
      updateData,
      beforeData,
      afterData,
      'validFrom',
      formatDate(existing.validFrom),
      formatDate(validFrom),
      validFrom
    );
  }
  if (patch.validTo !== undefined) {
    recordChange(
      updateData,
      beforeData,
      afterData,
      'validTo',
      formatDate(existing.validTo),
      formatDate(validTo),
      validTo
    );
  }
  if (patch.status !== undefined || status !== existing.status) {
    recordChange(updateData, beforeData, afterData, 'status', existing.status, status);
  }
  if (patch.allowCarryOver !== undefined) {
    recordChange(
      updateData,
      beforeData,
      afterData,
      'allowCarryOver',
      existing.allowCarryOver,
      patch.allowCarryOver
    );
  }
  if (patch.description !== undefined) {
    recordChange(
      updateData,
      beforeData,
      afterData,
      'description',
      existing.description,
      patch.description
    );
  }
  if (patch.matchSkuId !== undefined) {
    recordChange(updateData, beforeData, afterData, 'matchSkuId', existing.matchSkuId, patch.matchSkuId);
  }
  if (patch.matchSkuGroupId !== undefined) {
    recordChange(
      updateData,
      beforeData,
      afterData,
      'matchSkuGroupId',
      existing.matchSkuGroupId,
      patch.matchSkuGroupId
    );
  }
  if (patch.matchProjectId !== undefined) {
    recordChange(
      updateData,
      beforeData,
      afterData,
      'matchProjectId',
      existing.matchProjectId,
      patch.matchProjectId
    );
  }

  return {
    ok: true,
    updateData,
    beforeData,
    afterData,
    ...(balanceChanged
      ? {
          balanceAdjustment: {
            amountDelta: remainingAmount.sub(existing.remainingAmount).toString(),
            remainingBefore: existing.remainingAmount.toString(),
            remainingAfter: remainingAmount.toString(),
            reason: adjustmentReason,
          },
        }
      : {}),
  };
}
