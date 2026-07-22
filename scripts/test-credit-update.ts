import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { buildCreditUpdate } from '../src/lib/credits/update';
import { creditEditPayload, creditToEditForm } from '../src/lib/credits/edit-form';
import { compareCreditAmounts, creditAmountChanged } from '../src/lib/credits/decimal-input';

const existing = {
  types: ['DISCOUNT'] as const,
  totalAmount: new Prisma.Decimal('100'),
  remainingAmount: new Prisma.Decimal('80'),
  validFrom: new Date('2026-07-01T00:00:00.000Z'),
  validTo: new Date('2026-07-31T00:00:00.000Z'),
  status: 'ACTIVE' as const,
  allowCarryOver: false,
  description: null,
  matchSkuId: null,
  matchSkuGroupId: null,
  matchProjectId: null,
};

const expectedUpdatedAt = '2026-07-15T08:00:00.000Z';

assert.equal(creditAmountChanged('90000000000000.0000', '90000000000000.0001'), true);
assert.equal(creditAmountChanged('80', '80.0000'), false);
assert.equal(compareCreditAmounts('80.0001', '80.0000'), 1);
assert.equal(compareCreditAmounts('79.9999', '80'), -1);

const editable = buildCreditUpdate(existing, {
  types: ['DISCOUNT', 'PROMOTION'],
  totalAmount: '120',
  remainingAmount: '90',
  adjustmentReason: 'Correct contract balance',
  validFrom: '2026-06-01',
  validTo: '2026-12-31',
  status: 'ACTIVE',
  allowCarryOver: true,
  description: 'Contract credit',
  matchProjectId: 'soex-res',
});
assert.equal(editable.ok, true);
if (editable.ok) {
  assert.deepEqual(editable.updateData.types, ['DISCOUNT', 'PROMOTION']);
  assert.equal(String(editable.updateData.totalAmount), '120');
  assert.equal(String(editable.updateData.remainingAmount), '90');
  assert.equal((editable.updateData.validFrom as Date).toISOString(), '2026-06-01T00:00:00.000Z');
  assert.equal(editable.updateData.status, 'ACTIVE');
  assert.equal(editable.updateData.allowCarryOver, true);
  assert.equal(editable.updateData.matchProjectId, 'soex-res');
  assert.deepEqual(editable.balanceAdjustment, {
    amountDelta: '10',
    remainingBefore: '80',
    remainingAfter: '90',
    reason: 'Correct contract balance',
  });
}

const missingAdjustmentReason = buildCreditUpdate(existing, { remainingAmount: '90' });
assert.deepEqual(missingAdjustmentReason, {
  ok: false,
  error: 'Balance adjustment reason is required when remainingAmount changes',
});

const unchangedBalanceNeedsNoReason = buildCreditUpdate(existing, { remainingAmount: '80.0000' });
assert.equal(unchangedBalanceNeedsNoReason.ok, true);
if (unchangedBalanceNeedsNoReason.ok) {
  assert.equal(unchangedBalanceNeedsNoReason.balanceAdjustment, undefined);
}

const invalidRange = buildCreditUpdate(existing, {
  validFrom: '2026-08-01',
  validTo: '2026-07-31',
});
assert.deepEqual(invalidRange, { ok: false, error: 'validTo must be after validFrom' });

const invalidBalance = buildCreditUpdate(existing, { totalAmount: '50' });
assert.deepEqual(invalidBalance, {
  ok: false,
  error: 'remainingAmount cannot exceed totalAmount',
});

const activeWithoutBalance = buildCreditUpdate(existing, {
  remainingAmount: '0',
  status: 'ACTIVE',
  adjustmentReason: 'Use remaining balance',
});
assert.deepEqual(activeWithoutBalance, {
  ok: false,
  error: 'ACTIVE credit must have a positive remainingAmount',
});

const depletedWithBalance = buildCreditUpdate(existing, { status: 'DEPLETED' });
assert.deepEqual(depletedWithBalance, {
  ok: false,
  error: 'DEPLETED credit must have remainingAmount equal to 0',
});

const autoDepleted = buildCreditUpdate(existing, {
  remainingAmount: '0',
  adjustmentReason: 'Use remaining balance',
});
assert.equal(autoDepleted.ok, true);
if (autoDepleted.ok) assert.equal(autoDepleted.updateData.status, 'DEPLETED');

const replenish = buildCreditUpdate({ ...existing, status: 'DEPLETED' as const, remainingAmount: new Prisma.Decimal(0) }, {
  remainingAmount: '40',
  adjustmentReason: 'Restore approved balance',
});
assert.equal(replenish.ok, true);
if (replenish.ok) assert.equal(replenish.updateData.status, 'ACTIVE');

const editForm = creditToEditForm({
  types: ['DISCOUNT'],
  totalAmount: '100',
  remainingAmount: '80',
  validFrom: '2026-07-01',
  validTo: '2026-07-31',
  status: 'ACTIVE',
  allowCarryOver: false,
  description: null,
  matchSkuId: null,
  matchSkuGroupId: null,
  matchProjectId: null,
  updatedAt: expectedUpdatedAt,
});
assert.equal(editForm.totalAmount, '100');
assert.equal(editForm.remainingAmount, '80');
assert.equal(editForm.description, '');
assert.equal(editForm.expectedUpdatedAt, expectedUpdatedAt);
assert.equal(editForm.originalRemainingAmount, '80');
assert.equal(editForm.adjustmentReason, '');

assert.deepEqual(creditEditPayload({
  ...editForm,
  totalAmount: '120.5',
  remainingAmount: '90.25',
  adjustmentReason: '  Approved correction  ',
  description: '  Updated  ',
  matchSkuId: ' ',
  matchProjectId: ' soex-res ',
}), {
  types: ['DISCOUNT'],
  totalAmount: '120.5',
  remainingAmount: '90.25',
  adjustmentReason: 'Approved correction',
  expectedUpdatedAt,
  validFrom: '2026-07-01',
  validTo: '2026-07-31',
  status: 'ACTIVE',
  allowCarryOver: false,
  description: 'Updated',
  matchSkuId: null,
  matchSkuGroupId: null,
  matchProjectId: 'soex-res',
});

console.log('credit update tests passed');
