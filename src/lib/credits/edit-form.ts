import { creditAmountChanged } from './decimal-input';

export type CreditEditSource = {
  types: string[];
  totalAmount: string;
  remainingAmount: string;
  validFrom: string;
  validTo: string;
  status: 'ACTIVE' | 'EXPIRED' | 'DEPLETED';
  allowCarryOver: boolean;
  description: string | null;
  matchSkuId?: string | null;
  matchSkuGroupId?: string | null;
  matchProjectId?: string | null;
  updatedAt: string;
};

export type CreditEditFormData = {
  types: string[];
  totalAmount: string;
  remainingAmount: string;
  validFrom: string;
  validTo: string;
  status: 'ACTIVE' | 'EXPIRED' | 'DEPLETED';
  allowCarryOver: boolean;
  description: string;
  matchSkuId: string;
  matchSkuGroupId: string;
  matchProjectId: string;
  expectedUpdatedAt: string;
  originalRemainingAmount: string;
  adjustmentReason: string;
};

export function creditToEditForm(credit: CreditEditSource): CreditEditFormData {
  return {
    types: [...credit.types],
    totalAmount: credit.totalAmount,
    remainingAmount: credit.remainingAmount,
    validFrom: credit.validFrom,
    validTo: credit.validTo,
    status: credit.status,
    allowCarryOver: credit.allowCarryOver,
    description: credit.description ?? '',
    matchSkuId: credit.matchSkuId ?? '',
    matchSkuGroupId: credit.matchSkuGroupId ?? '',
    matchProjectId: credit.matchProjectId ?? '',
    expectedUpdatedAt: credit.updatedAt,
    originalRemainingAmount: credit.remainingAmount,
    adjustmentReason: '',
  };
}

export function creditEditPayload(form: CreditEditFormData) {
  const balanceChanged = creditAmountChanged(form.remainingAmount, form.originalRemainingAmount);
  return {
    types: form.types,
    totalAmount: form.totalAmount.trim(),
    remainingAmount: form.remainingAmount.trim(),
    ...(balanceChanged ? { adjustmentReason: form.adjustmentReason.trim() } : {}),
    expectedUpdatedAt: form.expectedUpdatedAt,
    validFrom: form.validFrom,
    validTo: form.validTo,
    status: form.status,
    allowCarryOver: form.allowCarryOver,
    description: form.description.trim() || null,
    matchSkuId: form.matchSkuId.trim() || null,
    matchSkuGroupId: form.matchSkuGroupId || null,
    matchProjectId: form.matchProjectId.trim() || null,
  };
}
